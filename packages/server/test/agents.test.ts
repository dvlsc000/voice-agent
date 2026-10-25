import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import {
  AgentPublishError,
  Db,
  activateVersion,
  createDraftVersion,
  provisionClient,
  publishVersion,
  runAgentSimulation,
  type ChatMessage,
  type ChatModel,
  type LlmEvent,
} from '../src/index';

const db = Db.fromUrl(process.env.DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:54329/postgres');
let org: string;
let agentId: string;
let v1: string;

/** A rule-based stand-in for a real model: behaves like a well-instructed receptionist (or a careless one). */
function policyModel(careless = false): ChatModel {
  return {
    id: careless ? 'policy-careless' : 'policy',
    async *stream({ messages }: { messages: ChatMessage[] }): AsyncIterable<LlmEvent> {
      const last = messages.at(-1)!;
      const sys = messages[0]!.content as string;
      const serviceId = sys.match(/\[([0-9a-f-]{36})\]/)?.[1] ?? '';
      // Only what was offered in THIS conversation (no state carried between calls).
      const availability = [...messages].reverse().find((m) => m.role === 'tool' && m.name === 'check_availability');
      let offered: { staff_id: string; start: string; spoken: string } | null = availability ? JSON.parse((availability as { content: string }).content).data?.options?.[0] ?? null : null;
      const tomorrow = DateTime.now().setZone('Europe/Dublin').plus({ days: 1 }).toISODate();
      const say = (t: string): LlmEvent[] => [{ type: 'text', delta: t }, { type: 'done' }];
      const tool = (name: string, args: object): LlmEvent[] => [{ type: 'tool_call', call: { id: randomUUID(), name, arguments: JSON.stringify(args) } }, { type: 'done' }];
      let out: LlmEvent[];
      if (last.role === 'tool' && last.name === 'check_availability') {
        out = offered ? say(`I have ${offered.spoken}. Shall I book that?`) : say('Nothing free then, sorry.');
      } else if (last.role === 'tool' && last.name === 'book_appointment') {
        out = say(`You're booked, reference ${JSON.parse(last.content).data.reference_spoken}.`);
      } else if (last.role === 'user' && /hot towel/i.test(last.content)) {
        out = say(careless ? 'That is €15.' : "I don't have a price for that. I can take a message for the team.");
      } else if (last.role === 'user' && /perfect|odgovara/i.test(last.content) && offered) {
        out = tool('book_appointment', { service_id: serviceId, staff_id: offered.staff_id, start: offered.start, customer_name: 'Alex Byrne', customer_phone: '+353871234567', caller_confirmed: true });
      } else if (last.role === 'user' && /book|anything|rezervirati/i.test(last.content)) {
        out = tool('check_availability', { service_id: serviceId, date: tomorrow, day_part: 'afternoon' });
      } else {
        out = say('Is there anything else?');
      }
      for (const e of out) yield e;
    },
  };
}

beforeAll(async () => {
  const r = await provisionClient(db, {
    businessName: 'Sim Barbers', industry: 'barbershop', country: 'IE', primaryLanguage: 'en', contactEmail: 'o@s.test', ownerEmail: 'o@s.test',
    hours: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, opens: '09:00', closes: '20:00' })), staff: [{ name: 'Mark' }],
  }, { actorUserId: null, idempotencyKey: randomUUID() });
  org = r.organizationId;
  agentId = r.agentId;
  v1 = r.agentVersionId;
});
afterAll(() => db.end());

describe('agent versions, test calls and publishing', () => {
  it('cannot publish without a passing test run', async () => {
    await expect(publishVersion(db, { versionId: v1, actorUserId: null })).rejects.toThrow(/Run the test calls/);
  });

  it('a careless assistant fails the test calls and stays unpublished', async () => {
    const r = await runAgentSimulation(db, { versionId: v1, model: policyModel(true), actorUserId: null });
    expect(r.passed).toBe(false);
    const price = r.results.find((x) => x.id === 'barber_unknown_price')!;
    expect(price.failures).toContain('the assistant said "€"');
    await expect(publishVersion(db, { versionId: v1, actorUserId: null })).rejects.toThrow(AgentPublishError);
  });

  it('a good assistant passes, publishes, and its test bookings never touched the real diary', async () => {
    const r = await runAgentSimulation(db, { versionId: v1, model: policyModel(), actorUserId: null });
    expect(r.results.map((x) => [x.id, x.passed, x.failures])).toEqual([
      ['barber_book_named_staff', true, []],
      ['barber_irish_colloquial_time', true, []],
      ['barber_unknown_price', true, []],
    ]);
    expect(r.results.some((x) => x.language === 'hr')).toBe(false); // English-only client: Croatian scenario skipped
    const real = await db.query(`select count(*)::int as n from public.appointments where organization_id = $1`, [org]);
    expect(real.rows[0].n).toBe(0);
    await publishVersion(db, { versionId: v1, actorUserId: null });
    const a = await db.query(`select active_version_id from public.agents where id = $1`, [agentId]);
    expect(a.rows[0].active_version_id).toBe(v1);
    const task = await db.query(`select status from public.onboarding_tasks where organization_id = $1 and kind = 'simulation_tests'`, [org]);
    expect(task.rows[0].status).toBe('done');
  });

  it('changes create a new version; rollback reactivates the old one instantly', async () => {
    const v2 = await createDraftVersion(db, { organizationId: org, agentId, patch: { agentName: 'Saoirse', customInstructions: 'Mention we have free parking.' }, actorUserId: null });
    await runAgentSimulation(db, { versionId: v2, model: policyModel(), actorUserId: null });
    await publishVersion(db, { versionId: v2, actorUserId: null });
    expect((await db.query(`select active_version_id from public.agents where id = $1`, [agentId])).rows[0].active_version_id).toBe(v2);
    await activateVersion(db, { agentId, versionId: v1, actorUserId: null });
    expect((await db.query(`select active_version_id from public.agents where id = $1`, [agentId])).rows[0].active_version_id).toBe(v1);
    const draft = await createDraftVersion(db, { organizationId: org, agentId, patch: {}, actorUserId: null });
    await expect(activateVersion(db, { agentId, versionId: draft, actorUserId: null })).rejects.toThrow(/Only published/);
  });

  it('recording cannot be switched on without a legal decision', async () => {
    await expect(createDraftVersion(db, { organizationId: org, agentId, patch: { recordingEnabled: true }, actorUserId: null })).rejects.toThrow(/legal decision/);
  });
});
