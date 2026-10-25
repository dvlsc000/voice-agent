import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { DateTime } from 'luxon';
import { BookingService, Db, ScriptedChatModel, ToolExecutor, provisionClient } from '@vp/server';
import { createGateway } from '../src/server';
import { twilioSignature } from '../src/twilio/signature';
import type { SpeechToText } from '../src/stt/types';
import type { CallControl } from '../src/twilio/call-control';
import { FakeStt, FakeTts, tick } from './fakes';

/**
 * Simulated phone call through the real gateway: signed Twilio webhook → TwiML → media WebSocket →
 * speech in → booking in the database → audio out → hang-up → call finalised. Only the speech and
 * model providers are simulated; HTTP, WebSocket protocol, auth, DB and booking logic are real.
 */
const db = Db.fromUrl(process.env.DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:54329/postgres');
const AUTH = 'test_auth_token_1234567890';
const SECRET = 'x'.repeat(40);
const number = `+35391${Math.floor(100000 + Math.random() * 899999)}`;
let org: string;
let serviceId: string;
let staffId: string;
let base = '';
let lastStt: FakeStt;
const hangups: string[] = [];
let gw: ReturnType<typeof createGateway>;

const sttProvider: SpeechToText = { id: 'fake', open: async () => (lastStt = new FakeStt()) };
const control: CallControl = { updateTwiml: async () => undefined, hangup: async (sid) => void hangups.push(sid) };

async function twilioPost(path: string, params: Record<string, string>, signatureOverride?: string): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': signatureOverride ?? twilioSignature(AUTH, `${base}${path}`, params) },
    body: new URLSearchParams(params),
  });
}

beforeAll(async () => {
  const r = await provisionClient(db, {
    businessName: 'Gateway Barbers', industry: 'barbershop', country: 'IE', primaryLanguage: 'en', contactEmail: 'o@g.test', ownerEmail: 'o@g.test',
    fallbackPhone: '091 777 888', hours: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, opens: '09:00', closes: '18:00' })), staff: [{ name: 'Mark' }],
  }, { actorUserId: null, idempotencyKey: randomUUID() });
  org = r.organizationId;
  await db.query(`update public.organizations set status = 'active' where id = $1`, [org]);
  await db.query(`update public.agent_versions set status = 'published', published_at = now() where id = $1`, [r.agentVersionId]);
  await db.query(`update public.agents set active_version_id = $1 where id = $2`, [r.agentVersionId, r.agentId]);
  await db.query(`insert into public.phone_numbers (organization_id, e164, country, connection_type, provider, status, agent_id) values ($1, $2, 'IE', 'provider_number', 'twilio', 'active', $3)`, [org, number, r.agentId]);
  staffId = (await db.query(`select id from public.staff_members where organization_id = $1`, [org])).rows[0].id;
  serviceId = (await db.query(`select id from public.services where organization_id = $1 order by sort_order limit 1`, [org])).rows[0].id;

  const day = DateTime.now().setZone('Europe/Dublin').plus({ days: 2 }).toISODate()!;
  let offered: any;
  const model = new ScriptedChatModel([
    () => ({ toolCalls: [{ name: 'check_availability', arguments: JSON.stringify({ service_id: serviceId, staff_id: staffId, date: day, day_part: 'afternoon' }) }] }),
    ({ lastToolResult }) => ((offered = (lastToolResult as any).data.options[0]), { text: `I have ${offered.spoken}. Shall I book it?` }),
    () => ({ toolCalls: [{ name: 'book_appointment', arguments: JSON.stringify({ service_id: serviceId, staff_id: offered.staff_id, start: offered.start, customer_name: 'Niamh Walsh', customer_phone: '+353861234567', caller_confirmed: true }) }] }),
    ({ lastToolResult }) => ({ text: `Done, you're booked. Reference ${(lastToolResult as any).data.reference_spoken}. Bye now.`, toolCalls: [{ name: 'end_call', arguments: '{"outcome":"completed"}' }] }),
  ]);
  gw = createGateway({
    db, publicBaseUrl: 'http://127.0.0.1:0', twilioAuthToken: AUTH, streamSecret: SECRET, stt: sttProvider, tts: new FakeTts(), model,
    tools: new ToolExecutor({ db, booking: new BookingService({ db }) }), callControl: control, log: () => undefined,
  });
  await new Promise<void>((res) => gw.server.listen(0, '127.0.0.1', () => res()));
  base = `http://127.0.0.1:${(gw.server.address() as AddressInfo).port}`;
  // publicBaseUrl must equal what Twilio calls; rebuild with the real port.
  gw.server.close();
  gw = createGateway({
    db, publicBaseUrl: base, twilioAuthToken: AUTH, streamSecret: SECRET, stt: sttProvider, tts: new FakeTts(), model,
    tools: new ToolExecutor({ db, booking: new BookingService({ db }) }), callControl: control, log: () => undefined,
  });
  await new Promise<void>((res) => gw.server.listen(Number(new URL(base).port), '127.0.0.1', () => res()));
});
afterAll(async () => {
  gw.server.close();
  await db.end();
});

describe('voice gateway end to end (simulated speech, real everything else)', () => {
  it('rejects webhooks without a valid Twilio signature', async () => {
    const res = await twilioPost('/twilio/voice', { CallSid: 'CAforged', To: number, From: '+353871111111' }, 'forged==');
    expect(res.status).toBe(403);
  });

  it('a caller books an appointment by phone', async () => {
    const callSid = `CA${randomUUID().replace(/-/g, '')}`;
    const res = await twilioPost('/twilio/voice', { CallSid: callSid, To: number, From: '+353861234567' });
    const twiml = await res.text();
    expect(twiml).toContain('<Connect><Stream url="ws://127.0.0.1:');
    expect(twiml).toContain('<Dial timeout="25">+35391777888</Dial>'); // fallback if the stream fails
    const callId = twiml.match(/name="callId" value="([^"]+)"/)![1]!;
    const token = twiml.match(/name="token" value="([^"]+)"/)![1]!;

    const ws = new WebSocket(`${base.replace('http', 'ws')}/twilio/stream`);
    const received: any[] = [];
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      received.push(m);
      if (m.event === 'mark') ws.send(JSON.stringify({ event: 'mark', streamSid: 'MZ1', mark: m.mark })); // audio "played"
    });
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ event: 'connected', protocol: 'Call', version: '1.0.0' }));
    ws.send(JSON.stringify({ event: 'start', streamSid: 'MZ1', start: { streamSid: 'MZ1', callSid, accountSid: 'AC1', tracks: ['inbound'], mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000, channels: 1 }, customParameters: { callId, token, level: 'full' } } }));
    await tick(150);
    ws.send(JSON.stringify({ event: 'media', streamSid: 'MZ1', media: { track: 'inbound', payload: Buffer.alloc(160, 0xff).toString('base64') } }));
    await tick(20);
    expect(lastStt.audio).toBe(1); // caller audio reaches speech recognition

    const spoken = () => received.filter((m) => m.event === 'media').map((m) => Buffer.from(m.media.payload, 'base64').toString());
    expect(spoken()[0]).toMatch(/Gateway Barbers.*virtual assistant/);
    lastStt.say('Could I get a haircut the day after tomorrow in the afternoon?');
    await tick(200);
    expect(spoken().at(-1)).toMatch(/^Shall I book it\?$/);
    lastStt.say('Yes please, Niamh Walsh');
    await tick(300);
    expect(spoken().join(' ')).toMatch(/Done, you're booked\. Reference \d( \d){5}\. Bye now\./);
    expect(hangups).toContain(callSid);
    ws.send(JSON.stringify({ event: 'stop', streamSid: 'MZ1', stop: { callSid, accountSid: 'AC1' } }));
    ws.close();
    await tick(200);

    const call = (await db.query(`select outcome, duration_sec, ended_by, cost_micros from public.calls where id = $1`, [callId])).rows[0];
    expect(call.outcome).toBe('booked');
    expect(call.ended_by).toBe('agent');
    expect(Number(call.cost_micros)).toBeGreaterThanOrEqual(0);
    const appt = (await db.query(`select status, source from public.appointments where call_id = $1`, [callId])).rows[0];
    expect(appt).toEqual({ status: 'confirmed', source: 'voice' });
    const transcript = (await db.query(`select segments from public.call_transcripts where call_id = $1`, [callId])).rows[0];
    expect(transcript.segments.filter((s: any) => s.role === 'caller')).toHaveLength(2);
    const usage = (await db.query(`select count(*)::int as n from public.usage_events where call_id = $1`, [callId])).rows[0].n;
    expect(usage).toBe(1);
  });

  it('a forged media stream (bad token) is refused', async () => {
    const ws = new WebSocket(`${base.replace('http', 'ws')}/twilio/stream`);
    await new Promise((r) => ws.once('open', r));
    const closed = new Promise<number>((r) => ws.once('close', (code) => r(code)));
    ws.send(JSON.stringify({ event: 'start', streamSid: 'MZ2', start: { streamSid: 'MZ2', callSid: 'CAx', customParameters: { callId: randomUUID(), token: '1.forged' } } }));
    expect(await closed).toBe(1008);
  });

  it('numbers that are not live are forwarded to the business, never answered by AI', async () => {
    await db.query(`update public.organizations set status = 'onboarding' where id = $1`, [org]);
    const res = await twilioPost('/twilio/voice', { CallSid: `CA${randomUUID().slice(0, 8)}`, To: number, From: '+353861234567' });
    expect(await res.text()).toContain('<Dial timeout="25">+35391777888</Dial>');
    await db.query(`update public.organizations set status = 'active' where id = $1`, [org]);
  });
});
