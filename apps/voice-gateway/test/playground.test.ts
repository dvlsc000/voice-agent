import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { DateTime } from 'luxon';
import { BookingService, Db, ScriptedChatModel, type ScriptStep } from '@vp/server';
import { ensureDemoBusinesses, type DemoBusiness } from '../src/playground/demo-businesses';
import { createPlayground } from '../src/playground/server';
import type { SpeechToText } from '../src/stt/types';
import { FakeStt, FakeTts, tick } from './fakes';

/**
 * Browser playground end to end: demo businesses are created and published, a typed chat and a
 * microphone call (simulated speech) each book a real appointment through the production code path.
 */
const db = Db.fromUrl(process.env.DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:54329/postgres');
let businesses: DemoBusiness[];
let base = '';
let lastStt: FakeStt;
let server: ReturnType<typeof createPlayground>;
let steps: ScriptStep[] = [];
const model = new ScriptedChatModel([(c) => steps[0]!(c)]);

/** A fresh script per test (the scripted model counts calls, so route through a per-test array). */
function script(s: ScriptStep[]): void {
  let i = 0;
  steps = [(c) => s[Math.min(i++, s.length - 1)]!(c)];
}

async function ids(slug: string) {
  const org = (await db.query(`select id from public.organizations where slug = $1`, [slug])).rows[0].id;
  const staff = (await db.query(`select id from public.staff_members where organization_id = $1 order by display_name limit 1`, [org])).rows[0].id;
  const service = (await db.query(`select id from public.services where organization_id = $1 order by sort_order limit 1`, [org])).rows[0].id;
  return { org, staff, service };
}

function bookingScript(serviceId: string, staffId: string, tz: string, name: string): ScriptStep[] {
  const day = DateTime.now().setZone(tz).plus({ days: 2 }).toISODate()!;
  let offered: any;
  return [
    () => ({ toolCalls: [{ name: 'check_availability', arguments: JSON.stringify({ service_id: serviceId, staff_id: staffId, date: day, day_part: 'afternoon' }) }] }),
    ({ lastToolResult }) => ((offered = (lastToolResult as any).data.options[0]), { text: `I have ${offered.spoken}. Shall I book it?` }),
    () => ({ toolCalls: [{ name: 'book_appointment', arguments: JSON.stringify({ service_id: serviceId, staff_id: offered.staff_id, start: offered.start, customer_name: name, customer_phone: '+353871234567', caller_confirmed: true }) }] }),
    ({ lastToolResult }) => ({ text: `You're booked. Reference ${(lastToolResult as any).data.reference_spoken}. Bye.`, toolCalls: [{ name: 'end_call', arguments: '{"outcome":"completed"}' }] }),
  ];
}

function collect(ws: WebSocket): any[] {
  const got: any[] = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    got.push(m);
    if (m.type === 'mark') ws.send(JSON.stringify({ event: 'mark', name: m.name })); // browser "played" the audio
  });
  return got;
}
async function until(cond: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await tick(20);
  }
}

beforeAll(async () => {
  businesses = await ensureDemoBusinesses(db);
  const stt: SpeechToText = { id: 'fake', open: async () => (lastStt = new FakeStt()) };
  server = createPlayground({
    db, booking: new BookingService({ db }), model, businesses, modelLabel: 'scripted', log: () => undefined,
    voice: { stt, tts: new FakeTts(), languages: ['en', 'hr'] },
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.close();
  await db.end();
});

describe('browser playground', () => {
  it('creates four live demo businesses with published assistants, idempotently', async () => {
    const again = await ensureDemoBusinesses(db);
    expect(again.map((b) => b.slug)).toEqual(businesses.map((b) => b.slug));
    expect(businesses.map((b) => b.language)).toEqual(['en', 'en', 'en', 'hr']);
    const { rows } = await db.query(
      `select o.status, v.status as version_status, (select count(*)::int from public.phone_numbers p where p.organization_id = o.id) as numbers
         from public.organizations o join public.agents a on a.organization_id = o.id join public.agent_versions v on v.id = a.active_version_id
        where o.slug = any($1)`,
      [businesses.map((b) => b.slug)],
    );
    expect(rows).toHaveLength(4);
    for (const r of rows) expect(r).toEqual({ status: 'active', version_status: 'published', numbers: 1 });
    expect(businesses[0]!.facts).toMatch(/Mark/);
  });

  it('serves the page and the setup', async () => {
    expect(await (await fetch(`http://${base}/`)).text()).toContain('Reception playground');
    const setup = (await (await fetch(`http://${base}/api/setup`)).json()) as any;
    expect(setup.businesses).toHaveLength(4);
    expect(setup.voice.languages).toEqual(['en', 'hr']);
  });

  it('typed chat books a real appointment', async () => {
    const b = businesses[0]!;
    const { staff, service } = await ids(b.slug);
    script(bookingScript(service, staff, b.timezone, 'Chat Tester'));
    const ws = new WebSocket(`ws://${base}/ws/chat?business=${b.slug}&caller=087%20123%204567`, { headers: { origin: `http://${base}` } });
    const got = collect(ws);
    await until(() => got.some((m) => m.type === 'ready'));
    const started = got.find((m) => m.type === 'started');
    expect(started.callerId).toBe('+353871234567');
    expect(got.find((m) => m.type === 'agent').text).toMatch(/Demo Barbers Dublin/);
    ws.send(JSON.stringify({ type: 'say', text: 'A haircut the day after tomorrow, afternoon please' }));
    await until(() => got.some((m) => m.type === 'agent' && /Shall I book it/.test(m.text)));
    expect(got.find((m) => m.type === 'tool' && m.name === 'check_availability').ok).toBe(true);
    ws.send(JSON.stringify({ type: 'say', text: 'Yes, Chat Tester' }));
    await until(() => got.some((m) => m.type === 'ended'));
    const ended = got.find((m) => m.type === 'ended');
    expect(ended.outcome).toBe('booked');
    const appt = (await db.query(`select status from public.appointments where call_id = $1`, [ended.callId])).rows[0];
    expect(appt.status).toBe('confirmed');
    const call = (await db.query(`select provider, outcome from public.calls where id = $1`, [ended.callId])).rows[0];
    expect(call).toEqual({ provider: 'playground', outcome: 'booked' });
    ws.close();
  });

  it('voice call: audio both ways, marks, booking and hang-up', async () => {
    const b = businesses[0]!;
    const { staff, service } = await ids(b.slug);
    script(bookingScript(service, staff, b.timezone, 'Voice Tester'));
    const ws = new WebSocket(`ws://${base}/ws/voice?business=${b.slug}&caller=`, { headers: { origin: `http://${base}` } });
    const got = collect(ws);
    await until(() => got.some((m) => m.type === 'media'));
    expect(got.find((m) => m.type === 'started').callerId).toBeNull();
    ws.send(JSON.stringify({ event: 'media', payload: Buffer.alloc(160, 0xff).toString('base64') }));
    await until(() => lastStt.audio > 0);
    lastStt.say('Haircut in two days in the afternoon');
    await until(() => got.some((m) => m.type === 'agent' && /Shall I book it/.test(m.text)));
    expect(got.some((m) => m.type === 'stt' && m.final)).toBe(true);
    lastStt.say('Yes please');
    await until(() => got.some((m) => m.type === 'action'));
    await until(() => got.some((m) => m.type === 'ended'));
    expect(got.find((m) => m.type === 'ended').outcome).toBe('booked');
    expect(got.find((m) => m.type === 'action').action.type).toBe('hang_up');
  });

  it('Croatian business answers in Croatian', async () => {
    const b = businesses[3]!;
    script([() => ({ text: 'Naravno, kada vam odgovara?' })]);
    const ws = new WebSocket(`ws://${base}/ws/chat?business=${b.slug}&caller=091%20123%204567`, { headers: { origin: `http://${base}` } });
    const got = collect(ws);
    await until(() => got.some((m) => m.type === 'ready'));
    expect(got.find((m) => m.type === 'started').callerId).toBe('+385911234567');
    expect(got.find((m) => m.type === 'agent').text).toMatch(/Demo Brijačnica Zagreb/);
    ws.send(JSON.stringify({ type: 'hangup' }));
    await until(() => got.some((m) => m.type === 'ended'));
  });

  it('refuses connections from other websites', async () => {
    const ws = new WebSocket(`ws://${base}/ws/chat?business=${businesses[0]!.slug}`, { headers: { origin: 'https://evil.example' } });
    const outcome = await new Promise<string>((r) => {
      ws.once('open', () => r('open'));
      ws.once('error', () => r('refused'));
    });
    expect(outcome).toBe('refused');
  });
});
