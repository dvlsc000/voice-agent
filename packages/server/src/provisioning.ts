import { z } from 'zod';
import {
  BUILTIN_TEMPLATES,
  COUNTRY_DEFAULTS,
  compileAgent,
  toE164,
  type AgentSettings,
  type Capability,
  type IndustryTemplate,
} from '@vp/core';
import type { Db, Queryable } from './db';
import { renderBusinessFacts } from './business-facts';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/** Everything the "Create client" wizard collects. Validated server-side; the browser is never trusted. */
export const createClientSchema = z.object({
  businessName: z.string().trim().min(2).max(200),
  industry: z.enum(['barbershop', 'dental', 'law_office', 'generic_service']),
  country: z.enum(['IE', 'HR']),
  primaryLanguage: z.enum(['en', 'hr']),
  additionalLanguages: z.array(z.enum(['en', 'hr'])).default([]),
  timezone: z.string().optional(),
  addressLine: z.string().trim().max(200).optional(),
  city: z.string().trim().max(100).optional(),
  websiteUrl: z.string().url().optional(),
  contactEmail: z.string().email(),
  fallbackPhone: z.string().optional(),
  ownerEmail: z.string().email(),
  hours: z
    .array(z.object({ weekday: z.number().int().min(1).max(7), opens: hhmm, closes: hhmm }))
    .default([]),
  staff: z.array(z.object({ name: z.string().trim().min(1).max(100) })).default([]),
  useTemplateServices: z.boolean().default(true),
  capabilities: z.array(z.string()).optional(),
  planCode: z.string().default('starter'),
});
export type CreateClientInput = z.input<typeof createClientSchema>;

export const ONBOARDING_STEPS = [
  'tenant_created',
  'configuration_applied',
  'agent_draft_created',
  'phone_number',
  'calendar_connection',
  'simulation_tests',
  'supervised_test_call',
  'activation',
] as const;

function slugify(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/gi, 'd')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'client'
  );
}

export interface ProvisionResult {
  organizationId: string;
  sessionId: string;
  agentId: string;
  agentVersionId: string;
  blockers: string[];
}

/**
 * Creates a fully configured tenant from an industry template in ONE transaction:
 * organization, location, hours, staff, services, booking rules, retention, onboarding tasks and a DRAFT agent.
 * Nothing goes live here — phone routing and activation are separate, gated steps.
 * Idempotent on `idempotencyKey` (retrying the wizard submit never creates a second client).
 */
export async function provisionClient(db: Db, raw: CreateClientInput, opts: { actorUserId: string | null; idempotencyKey: string }): Promise<ProvisionResult> {
  const input = createClientSchema.parse(raw);
  const template: IndustryTemplate = BUILTIN_TEMPLATES[input.industry]!;
  const tz = input.timezone ?? COUNTRY_DEFAULTS[input.country].timezone;
  const fallback = input.fallbackPhone ? toE164(input.fallbackPhone, input.country) : null;
  if (input.fallbackPhone && !fallback) throw new z.ZodError([{ code: 'custom', path: ['fallbackPhone'], message: 'Not a valid phone number' }]);

  return db.tx(async (q) => {
    // Idempotency: the key is stored on the onboarding session.
    const prior = await q.query(
      `select s.id as session_id, s.organization_id, a.id as agent_id, a.active_version_id,
              (select id from public.agent_versions v where v.agent_id = a.id order by version_no desc limit 1) as version_id
         from public.onboarding_sessions s left join public.agents a on a.organization_id = s.organization_id
        where s.answers ->> 'idempotency_key' = $1`,
      [opts.idempotencyKey],
    );
    if (prior.rows[0]) {
      const p = prior.rows[0];
      return { organizationId: p.organization_id, sessionId: p.session_id, agentId: p.agent_id, agentVersionId: p.version_id, blockers: await blockersFor(q, p.organization_id) };
    }

    await ensureTemplate(q, template);
    let slug = slugify(input.businessName);
    const clash = await q.query(`select 1 from public.organizations where slug = $1`, [slug]);
    if (clash.rowCount) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;

    const org = (
      await q.query(
        `insert into public.organizations (name, slug, industry_template_id, country, timezone, primary_language, additional_languages,
                                           status, website_url, contact_email, fallback_phone_e164)
         values ($1, $2, $3, $4, $5, $6, $7, 'onboarding', $8, $9, $10) returning id`,
        [input.businessName, slug, template.id, input.country, tz, input.primaryLanguage, input.additionalLanguages, input.websiteUrl ?? null, input.contactEmail, fallback],
      )
    ).rows[0].id as string;

    const loc = (
      await q.query(`insert into public.locations (organization_id, name, is_primary, address_line, city) values ($1, $2, true, $3, $4) returning id`, [
        org, input.businessName, input.addressLine ?? null, input.city ?? null,
      ])
    ).rows[0].id as string;
    for (const h of input.hours) {
      await q.query(`insert into public.business_hours (organization_id, location_id, weekday, opens, closes) values ($1, $2, $3, $4, $5)`, [org, loc, h.weekday, h.opens, h.closes]);
    }
    for (const s of input.staff) {
      const staffId = (await q.query(`insert into public.staff_members (organization_id, display_name, location_id) values ($1, $2, $3) returning id`, [org, s.name, loc])).rows[0].id;
      // Default: staff work the business hours; refined later in the dashboard.
      for (const h of input.hours) {
        await q.query(`insert into public.staff_hours (organization_id, staff_id, weekday, starts, ends) values ($1, $2, $3, $4, $5)`, [org, staffId, h.weekday, h.opens, h.closes]);
      }
    }
    if (input.useTemplateServices) {
      let order = 0;
      for (const s of template.defaultServices) {
        await q.query(
          `insert into public.services (organization_id, names, duration_min, buffer_after_min, price_minor, price_is_from, price_approved, sort_order)
           values ($1, $2, $3, $4, $5, $6, false, $7)`,
          [org, JSON.stringify(s.name), s.durationMin, s.bufferAfterMin, s.priceMinor, s.priceIsFrom, order++],
        );
      }
    }
    await q.query(`insert into public.booking_rules (organization_id) values ($1)`, [org]);
    await q.query(`insert into public.retention_policies (organization_id, transcript_days) values ($1, $2)`, [org, template.privacy.transcriptRetentionDays]);
    await q.query(`insert into public.subscriptions (organization_id, plan_code, status) values ($1, $2, 'incomplete')`, [org, input.planCode]);

    const session = (
      await q.query(`insert into public.onboarding_sessions (organization_id, current_step, answers, created_by) values ($1, 'review', $2, $3) returning id`, [
        org,
        JSON.stringify({ idempotency_key: opts.idempotencyKey, owner_email: input.ownerEmail }),
        opts.actorUserId,
      ])
    ).rows[0].id as string;
    for (const step of ONBOARDING_STEPS) {
      const done = step === 'tenant_created' || step === 'configuration_applied' || step === 'agent_draft_created';
      await q.query(`insert into public.onboarding_tasks (organization_id, session_id, kind, status) values ($1, $2, $3, $4)`, [org, session, step, done ? 'done' : 'pending']);
    }

    // Draft agent compiled from the template — no hand-written prompt per client.
    const caps = (input.capabilities?.length ? input.capabilities : template.defaultCapabilities).filter((c): c is Capability =>
      (template.allowedCapabilities as string[]).includes(c),
    );
    const settings: AgentSettings = {
      agentName: input.primaryLanguage === 'hr' ? 'Ana' : 'Nora',
      primaryLanguage: input.primaryLanguage,
      additionalLanguages: input.additionalLanguages.filter((l) => l !== input.primaryLanguage),
      allowLanguageSwitch: true,
      formality: input.primaryLanguage === 'hr' ? 'formal' : 'neutral',
      enabledCapabilities: caps,
      voice: { provider: 'unassigned', voiceId: 'unassigned', speed: 1 },
      pronunciations: [],
      customInstructions: '',
      maxCallDurationSec: 900,
      recordingEnabled: false,
      transcriptsEnabled: template.privacy.transcriptsDefault,
    };
    const agent = (await q.query(`insert into public.agents (organization_id, name) values ($1, 'Phone assistant') returning id`, [org])).rows[0].id as string;
    const facts = await renderBusinessFacts(q, org, input.primaryLanguage);
    const compiled = compileAgent(template, settings, { businessName: input.businessName, timezone: tz, factsText: facts });
    const version = (
      await q.query(
        `insert into public.agent_versions (organization_id, agent_id, version_no, template_id, template_version, settings, compiled, content_hash, status, created_by)
         values ($1, $2, 1, $3, $4, $5, $6, $7, 'draft', $8) returning id`,
        [org, agent, template.id, template.version, JSON.stringify(settings), JSON.stringify(compiled), compiled.contentHash, opts.actorUserId],
      )
    ).rows[0].id as string;

    return { organizationId: org, sessionId: session, agentId: agent, agentVersionId: version, blockers: await blockersFor(q, org) };
  }, { actorUserId: opts.actorUserId });
}

async function ensureTemplate(q: Queryable, t: IndustryTemplate): Promise<void> {
  await q.query(
    `insert into public.industry_templates (id, version, definition, is_current) values ($1, $2, $3, false)
     on conflict (id, version) do nothing`,
    [t.id, t.version, JSON.stringify(t)],
  );
  await q.query(`update public.industry_templates set is_current = (version = $2) where id = $1`, [t.id, t.version]);
}

/** Plain-language list of what still stops this client going live. Drives the onboarding checklist. */
export async function blockersFor(q: Queryable, organizationId: string): Promise<string[]> {
  const b: string[] = [];
  const has = async (sql: string) => ((await q.query(sql, [organizationId])).rowCount ?? 0) > 0;
  if (!(await has(`select 1 from public.business_hours where organization_id = $1`))) b.push('Add opening hours');
  if (!(await has(`select 1 from public.services where organization_id = $1 and active`))) b.push('Add at least one service');
  if (await has(`select 1 from public.services where organization_id = $1 and active and price_minor is not null and not price_approved`))
    b.push('Approve service prices (unapproved prices are never quoted)');
  if (!(await has(`select 1 from public.staff_members where organization_id = $1 and active and bookable`))) b.push('Add bookable staff');
  if (!(await has(`select 1 from public.phone_numbers where organization_id = $1 and status = 'active'`))) b.push('Connect a phone number');
  if (!(await has(`select 1 from public.organizations where id = $1 and fallback_phone_e164 is not null`))) b.push('Set a fallback number for transfers and outages');
  if (!(await has(`select 1 from public.agents a join public.agent_versions v on v.id = a.active_version_id where a.organization_id = $1 and v.status = 'published'`)))
    b.push('Run tests and publish the assistant');
  return b;
}
