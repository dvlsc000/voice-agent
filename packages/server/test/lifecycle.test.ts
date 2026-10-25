import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Db, finalizeCall, loadCallRuntime, provisionClient, startInboundCall } from '../src/index';

const db = Db.fromUrl(process.env.DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:54329/postgres');
let org: string;
const number = `+35391${Math.floor(100000 + Math.random() * 899999)}`;

async function publish(): Promise<void> {
  await db.query(
    `update public.agent_versions set status = 'published', published_at = now() where organization_id = $1`, [org]);
  await db.query(`update public.agents a set active_version_id = v.id from public.agent_versions v where v.agent_id = a.id and a.organization_id = $1`, [org]);
}

beforeAll(async () => {
  const r = await provisionClient(db, {
    businessName: 'Lifecycle Dental', industry: 'dental', country: 'IE', primaryLanguage: 'en',
    contactEmail: 'o@l.test', ownerEmail: 'o@l.test', fallbackPhone: '091 555 123',
    hours: [{ weekday: 1, opens: '09:00', closes: '17:00' }], staff: [{ name: 'Dr Byrne' }],
  }, { actorUserId: null, idempotencyKey: randomUUID() });
  org = r.organizationId;
  await db.query(
    `insert into public.phone_numbers (organization_id, e164, country, connection_type, provider, status, agent_id) values ($1, $2, 'IE', 'provider_number', 'twilio', 'active', $3)`,
    [org, number, r.agentId],
  );
});
afterAll(() => db.end());

describe('inbound call routing', () => {
  it('unknown numbers are not answered by anyone’s assistant', async () => {
    expect(await startInboundCall(db, { provider: 'twilio', providerCallId: randomUUID(), toE164: '+35310000000', fromE164: null })).toMatchObject({ type: 'unavailable' });
  });

  it('forwards to the business while it is still onboarding (no published assistant)', async () => {
    const d = await startInboundCall(db, { provider: 'twilio', providerCallId: randomUUID(), toE164: number, fromE164: '+353871234567' });
    expect(d).toMatchObject({ type: 'forward', target: '+35391555123', reason: 'not_live' });
  });

  it('answers with the assistant once live, and restricts to messages when billing is 20 days overdue', async () => {
    await publish();
    await db.query(`update public.organizations set status = 'active' where id = $1`, [org]);
    const d = await startInboundCall(db, { provider: 'twilio', providerCallId: randomUUID(), toE164: number, fromE164: '+353871234567' });
    expect(d).toMatchObject({ type: 'agent', serviceLevel: 'full' });

    await db.query(`update public.subscriptions set status = 'past_due', past_due_since = now() - interval '20 days' where organization_id = $1`, [org]);
    const d2 = await startInboundCall(db, { provider: 'twilio', providerCallId: randomUUID(), toE164: number, fromE164: '+353871234567' });
    expect(d2).toMatchObject({ type: 'agent', serviceLevel: 'messages_only' });
    if (d2.type !== 'agent') throw new Error();
    const rt = await loadCallRuntime(db, d2.callId, d2.serviceLevel);
    expect(rt.session.ctx.agentToolAllowlist).not.toContain('book_appointment');
    expect(rt.session.ctx.agentToolAllowlist).toContain('take_message');
    expect(rt.agent.firstMessage).toMatch(/Lifecycle Dental/);
    expect(rt.agent.systemPrompt).toMatch(/Dr Byrne/); // live facts

    await db.query(`update public.subscriptions set status = 'unpaid', past_due_since = now() - interval '45 days' where organization_id = $1`, [org]);
    const d3 = await startInboundCall(db, { provider: 'twilio', providerCallId: randomUUID(), toE164: number, fromE164: '+353871234567' });
    expect(d3).toMatchObject({ type: 'forward', reason: 'billing' });
    await db.query(`update public.subscriptions set status = 'active', past_due_since = null where organization_id = $1`, [org]);
  });

  it('finalising is idempotent and records usage, cost and transcript with retention', async () => {
    const d = await startInboundCall(db, { provider: 'twilio', providerCallId: randomUUID(), toE164: number, fromE164: '+353871234567' });
    if (d.type !== 'agent') throw new Error('expected agent');
    const f = {
      durationSec: 125, endedBy: 'caller' as const, outcome: 'message_taken' as const,
      transcript: [{ role: 'caller' as const, text: 'hi', at: new Date().toISOString() }],
      transcriptsEnabled: true, escalationRuleId: null, language: 'en' as const, country: 'IE' as const,
    };
    await finalizeCall(db, d.callId, f);
    await finalizeCall(db, d.callId, { ...f, durationSec: 125 });
    const call = (await db.query(`select duration_sec, outcome, cost_micros from public.calls where id = $1`, [d.callId])).rows[0];
    expect(call).toMatchObject({ duration_sec: 125, outcome: 'message_taken' });
    expect(Number(call.cost_micros)).toBeGreaterThan(0);
    const usage = (await db.query(`select sum(quantity)::int as s from public.usage_events where call_id = $1`, [d.callId])).rows[0].s;
    expect(usage).toBe(125);
    const t = (await db.query(`select retain_until > now() + interval '29 days' and retain_until < now() + interval '31 days' as ok from public.call_transcripts where call_id = $1`, [d.callId])).rows[0];
    expect(t.ok).toBe(true); // dental template: 30-day transcript retention
  });
});
