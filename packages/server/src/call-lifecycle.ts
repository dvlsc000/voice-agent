import {
  compileAgent,
  costPerMinute,
  serviceLevelForBilling,
  templateSchema,
  toolsForCapabilities,
  type AgentSettings,
  type Capability,
  type CompiledAgent,
  type IndustryTemplate,
  type Language,
  type ServiceLevel,
} from '@vp/core';
import { renderBusinessFacts } from './business-facts';
import type { Db } from './db';
import type { CallOutcome, TranscriptSegment } from './conversation/engine';
import type { CallSession } from './tool-executor';

export type InboundDecision =
  | { type: 'agent'; callId: string; organizationId: string; serviceLevel: ServiceLevel; language: Language }
  | { type: 'forward'; target: string; reason: string; callId: string | null }
  | { type: 'unavailable'; reason: string; language: Language };

/**
 * First thing that happens on an inbound call. Tenant context comes ONLY from the dialled number.
 * Decides whether the AI answers, or the call goes straight to the business's own phone
 * (not live yet, billing lapsed, no published assistant).
 */
export async function startInboundCall(
  db: Db,
  input: { provider: string; providerCallId: string; toE164: string; fromE164: string | null; now?: Date },
): Promise<InboundDecision> {
  const { rows } = await db.query(
    `select p.id as phone_id, o.id as org_id, o.status as org_status, o.fallback_phone_e164, o.primary_language,
            s.status as billing_status, s.past_due_since,
            a.active_version_id, v.status as version_status
       from public.phone_numbers p
       join public.organizations o on o.id = p.organization_id
       left join public.subscriptions s on s.organization_id = o.id
       left join public.agents a on a.id = p.agent_id
       left join public.agent_versions v on v.id = a.active_version_id
      where p.e164 = $1 and p.status = 'active'`,
    [input.toE164],
  );
  const r = rows[0];
  if (!r) return { type: 'unavailable', reason: 'number_not_routed', language: 'en' };

  const now = input.now ?? new Date();
  const daysPastDue = r.past_due_since ? Math.floor((now.getTime() - new Date(r.past_due_since).getTime()) / 86_400_000) : 0;
  let level: ServiceLevel = r.billing_status ? serviceLevelForBilling(r.billing_status, daysPastDue) : 'full';
  if (r.org_status === 'suspended') level = level === 'full' ? 'messages_only' : level;
  const notLive = r.org_status === 'onboarding' || r.org_status === 'closed' || !r.active_version_id || r.version_status !== 'published';

  const insertCall = async (outcome: string | null) =>
    (
      await db.query(
        `insert into public.calls (organization_id, phone_number_id, agent_version_id, provider, provider_call_id, from_e164, to_e164, started_at, outcome, language)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         on conflict (provider, provider_call_id) do update set provider_call_id = excluded.provider_call_id
         returning id`,
        [r.org_id, r.phone_id, notLive ? null : r.active_version_id, input.provider, input.providerCallId, input.fromE164, input.toE164, now, outcome, r.primary_language],
      )
    ).rows[0].id as string;

  if (notLive || level === 'forward_only') {
    const callId = await insertCall('transferred');
    if (r.fallback_phone_e164) return { type: 'forward', target: r.fallback_phone_e164, reason: notLive ? 'not_live' : 'billing', callId };
    return { type: 'unavailable', reason: notLive ? 'not_live' : 'billing', language: r.primary_language };
  }
  const callId = await insertCall(null);
  return { type: 'agent', callId, organizationId: r.org_id, serviceLevel: level, language: r.primary_language };
}

export interface CallRuntime {
  session: CallSession;
  agent: CompiledAgent;
  template: IndustryTemplate;
  settings: AgentSettings;
  fallbackPhone: string | null;
  country: 'IE' | 'HR';
  /** Words that help speech recognition: staff and service names. */
  keyterms: string[];
}

const MESSAGES_ONLY: Capability[] = ['reception', 'messages', 'human_handoff'];

/** Everything the conversation needs, built fresh per call (published behaviour + live business facts). */
export async function loadCallRuntime(db: Db, callId: string, serviceLevel: ServiceLevel): Promise<CallRuntime> {
  const { rows } = await db.query(
    `select c.id, c.organization_id, c.from_e164, c.agent_version_id, o.name, o.timezone, o.status, o.fallback_phone_e164, o.country,
            v.settings, t.definition
       from public.calls c
       join public.organizations o on o.id = c.organization_id
       join public.agent_versions v on v.id = c.agent_version_id
       join public.industry_templates t on t.id = v.template_id and t.version = v.template_version
      where c.id = $1`,
    [callId],
  );
  const r = rows[0];
  if (!r) throw new Error(`Call ${callId} has no published assistant`);
  const template = templateSchema.parse(r.definition);
  const settings = r.settings as AgentSettings;
  const caps = serviceLevel === 'messages_only' ? settings.enabledCapabilities.filter((c) => MESSAGES_ONLY.includes(c)) : settings.enabledCapabilities;
  const effective: AgentSettings = { ...settings, enabledCapabilities: caps.length ? caps : ['reception'] };
  const facts = await renderBusinessFacts(db, r.organization_id, settings.primaryLanguage);
  const agent = compileAgent(template, effective, { businessName: r.name, timezone: r.timezone, factsText: facts });
  const session: CallSession = {
    ctx: {
      organizationId: r.organization_id,
      callId,
      agentVersionId: r.agent_version_id,
      enabledCapabilities: effective.enabledCapabilities,
      agentToolAllowlist: toolsForCapabilities(effective.enabledCapabilities).filter((t) => agent.tools.includes(t)),
      verifiedBookingIds: new Set(),
      offeredSlots: new Set(),
      toolCallsSoFar: 0,
      consequentialCallsSoFar: 0,
      organizationStatus: r.status,
    },
    callerIdE164: r.from_e164,
    timezone: r.timezone,
    language: settings.primaryLanguage,
    verificationAttempts: 0,
  };
  const names = await db.query(
    `select display_name as n from public.staff_members where organization_id = $1 and active
     union select coalesce(names ->> $2, names ->> 'en') from public.services where organization_id = $1 and active`,
    [r.organization_id, settings.primaryLanguage],
  );
  const keyterms = names.rows.map((x) => String(x.n)).filter(Boolean).slice(0, 50);
  return { session, agent, template, settings: effective, fallbackPhone: r.fallback_phone_e164, country: r.country, keyterms };
}

export interface FinalizeInput {
  durationSec: number;
  endedBy: 'caller' | 'agent' | 'error' | 'timeout';
  outcome: CallOutcome;
  transcript: TranscriptSegment[];
  transcriptsEnabled: boolean;
  escalationRuleId: string | null;
  summary?: string | null;
  language: Language;
  country: 'IE' | 'HR';
  stack?: 'eu_native' | 'vapi_eu' | 'retell';
}

/**
 * Close a call: outcome, duration, transcript (with retention), billable usage and estimated provider cost.
 * Idempotent: running it twice (e.g. stream close + status callback) does not double-count.
 */
export async function finalizeCall(db: Db, callId: string, f: FinalizeInput): Promise<void> {
  await db.tx(async (q) => {
    const { rows } = await q.query(
      `update public.calls set ended_at = coalesce(ended_at, now()), duration_sec = greatest(coalesce(duration_sec, 0), $2),
              ended_by = coalesce(ended_by, $3), outcome = coalesce(outcome, $4), escalation_rule_id = coalesce(escalation_rule_id, $5),
              summary = coalesce(summary, $6)
        where id = $1 returning organization_id`,
      [callId, Math.max(0, Math.round(f.durationSec)), f.endedBy, f.outcome, f.escalationRuleId, f.summary ?? null],
    );
    const org = rows[0]?.organization_id as string | undefined;
    if (!org) return;

    if (f.transcriptsEnabled && f.transcript.length) {
      await q.query(
        `insert into public.call_transcripts (call_id, organization_id, segments, retain_until)
         select $1, $2, $3, now() + make_interval(days => coalesce((select transcript_days from public.retention_policies where organization_id = $2), 90))
         on conflict (call_id) do nothing`,
        [callId, org, JSON.stringify(f.transcript)],
      );
    }

    const seconds = Math.max(0, Math.round(f.durationSec));
    await q.query(
      `insert into public.usage_events (organization_id, call_id, metric, quantity, occurred_at, idempotency_key)
       values ($1, $2, 'call_seconds', $3, now(), $4) on conflict (idempotency_key) do nothing`,
      [org, callId, seconds, `call:${callId}:seconds`],
    );

    const c = costPerMinute({ country: f.country, language: f.language, stack: f.stack ?? 'eu_native', llmTier: 'small' });
    const minutes = seconds / 60;
    const components: Array<[string, number]> = [
      ['telephony', c.telephony + c.media],
      ['stt', c.stt],
      ['llm', c.llm],
      ['tts', c.tts],
      ['platform', c.platform],
    ];
    let total = 0;
    for (const [component, perMin] of components) {
      if (perMin <= 0) continue;
      const micros = Math.round(perMin * minutes * 1e6);
      total += micros;
      await q.query(
        `insert into public.provider_cost_events (organization_id, call_id, provider, component, quantity, unit, amount_micros, currency, estimated, occurred_at, idempotency_key)
         values ($1, $2, $3, $4, $5, 'min', $6, 'USD', true, now(), $7) on conflict (idempotency_key) do nothing`,
        [org, callId, f.stack ?? 'eu_native', component, minutes, micros, `call:${callId}:cost:${component}`],
      );
    }
    await q.query(`update public.calls set cost_micros = $2 where id = $1 and cost_micros = 0`, [callId, total]);
  });
}
