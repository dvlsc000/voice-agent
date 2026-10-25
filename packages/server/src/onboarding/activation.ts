import { toE164 } from '@vp/core';
import { blockersFor } from '../provisioning';
import type { Db } from '../db';
import type { ImportSuggestions } from './website-import';

/** Twilio phone-number management (REST). Number configuration lives in Twilio's main API. */
export class TwilioNumbers {
  constructor(private readonly opts: { accountSid: string; authToken: string; fetch?: typeof fetch }) {}
  private async call(method: 'GET' | 'POST', path: string, form?: Record<string, string>): Promise<any> {
    const res = await (this.opts.fetch ?? fetch)(`https://api.twilio.com/2010-04-01/Accounts/${this.opts.accountSid}${path}`, {
      method,
      signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Basic ${Buffer.from(`${this.opts.accountSid}:${this.opts.authToken}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: form ? new URLSearchParams(form) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Twilio ${res.status}: ${(json as any).message ?? 'error'}`);
    return json;
  }
  async searchLocal(country: 'IE' | 'HR', contains?: string): Promise<Array<{ e164: string; locality: string | null }>> {
    const q = new URLSearchParams({ VoiceEnabled: 'true', PageSize: '10', ...(contains ? { Contains: contains } : {}) });
    const r = await this.call('GET', `/AvailablePhoneNumbers/${country}/Local.json?${q}`);
    return (r.available_phone_numbers ?? []).map((n: any) => ({ e164: n.phone_number, locality: n.locality ?? null }));
  }
  /** Buying a number costs money and may need a regulatory bundle (Ireland/Croatia): only called on an explicit operator action. */
  async purchase(input: { e164: string; voiceUrl: string; statusCallback: string; bundleSid?: string; addressSid?: string }): Promise<{ sid: string }> {
    const r = await this.call('POST', '/IncomingPhoneNumbers.json', {
      PhoneNumber: input.e164, VoiceUrl: input.voiceUrl, VoiceMethod: 'POST', StatusCallback: input.statusCallback, StatusCallbackMethod: 'POST',
      ...(input.bundleSid ? { BundleSid: input.bundleSid } : {}), ...(input.addressSid ? { AddressSid: input.addressSid } : {}),
    });
    return { sid: r.sid };
  }
  /** Point a number already in our Twilio account at the gateway. */
  async configureExisting(input: { e164: string; voiceUrl: string; statusCallback: string }): Promise<{ sid: string }> {
    const list = await this.call('GET', `/IncomingPhoneNumbers.json?${new URLSearchParams({ PhoneNumber: input.e164 })}`);
    const n = list.incoming_phone_numbers?.[0];
    if (!n) throw new Error('That number is not in the Twilio account.');
    await this.call('POST', `/IncomingPhoneNumbers/${n.sid}.json`, { VoiceUrl: input.voiceUrl, VoiceMethod: 'POST', StatusCallback: input.statusCallback, StatusCallbackMethod: 'POST' });
    return { sid: n.sid };
  }
}

export type PhoneConnection = 'provider_number' | 'forwarded' | 'sip_byoc' | 'ported';

/** Record which number routes to this client. The unique index guarantees a number serves only one client. */
export async function registerPhoneNumber(
  db: Db,
  input: { organizationId: string; e164: string; country: 'IE' | 'HR'; connectionType: PhoneConnection; provider: string; providerNumberId?: string | null; status: 'active' | 'pending_regulatory' | 'porting' | 'provisioning'; actorUserId: string | null },
): Promise<string> {
  const e164 = toE164(input.e164, input.country);
  if (!e164) throw new Error('That is not a valid phone number.');
  return db.tx(async (q) => {
    const agent = (await q.query(`select id from public.agents where organization_id = $1 order by created_at limit 1`, [input.organizationId])).rows[0];
    const { rows } = await q.query(
      `insert into public.phone_numbers (organization_id, e164, country, connection_type, provider, provider_number_id, status, agent_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [input.organizationId, e164, input.country, input.connectionType, input.provider, input.providerNumberId ?? null, input.status, agent?.id ?? null],
    );
    await q.query(
      `update public.onboarding_tasks set status = $2, blocked_reason = $3 where organization_id = $1 and kind = 'phone_number'`,
      [input.organizationId, input.status === 'active' ? 'done' : 'blocked', input.status === 'active' ? null : `Number ${e164}: ${input.status.replace('_', ' ')}`],
    );
    return rows[0].id as string;
  }, { actorUserId: input.actorUserId });
}

export async function setOnboardingTask(db: Db, input: { organizationId: string; kind: string; status: 'done' | 'pending' | 'blocked' | 'skipped'; reason?: string; actorUserId: string | null }): Promise<void> {
  await db.tx(
    (q) => q.query(`update public.onboarding_tasks set status = $3, blocked_reason = $4 where organization_id = $1 and kind = $2`, [input.organizationId, input.kind, input.status, input.reason ?? null]),
    { actorUserId: input.actorUserId },
  );
}

export class GoLiveBlockedError extends Error {
  override name = 'GoLiveBlockedError';
  constructor(readonly blockers: string[]) {
    super(`Not ready to go live: ${blockers.join('; ')}`);
  }
}

/**
 * Activation gate: everything on the checklist, including a supervised test call by a person.
 * The client becomes 'trial' (or 'active' if already paying); calls start reaching the assistant immediately.
 */
export async function goLive(db: Db, input: { organizationId: string; actorUserId: string | null }): Promise<void> {
  const blockers = await blockersFor(db, input.organizationId);
  const supervised = (await db.query(`select status from public.onboarding_tasks where organization_id = $1 and kind = 'supervised_test_call'`, [input.organizationId])).rows[0];
  if (supervised?.status !== 'done') blockers.push('Make a supervised test call and confirm it went well');
  if (blockers.length) throw new GoLiveBlockedError(blockers);
  await db.tx(async (q) => {
    const sub = (await q.query(`select status from public.subscriptions where organization_id = $1`, [input.organizationId])).rows[0];
    await q.query(`update public.organizations set status = $2 where id = $1 and status = 'onboarding'`, [input.organizationId, sub?.status === 'active' ? 'active' : 'trial']);
    await q.query(`update public.onboarding_tasks set status = 'done' where organization_id = $1 and kind = 'activation'`, [input.organizationId]);
    await q.query(`update public.onboarding_sessions set status = 'live' where organization_id = $1`, [input.organizationId]);
  }, { actorUserId: input.actorUserId });
}

/** Apply reviewed website suggestions. Only what the operator ticked; prices arrive UNAPPROVED. */
export async function applyImportSuggestions(
  db: Db,
  input: { organizationId: string; suggestions: ImportSuggestions; apply: { address: boolean; phone: boolean; hours: boolean; services: string[] }; country: 'IE' | 'HR'; actorUserId: string | null },
): Promise<{ applied: string[] }> {
  const s = input.suggestions;
  const applied: string[] = [];
  await db.tx(async (q) => {
    const loc = (await q.query(`select id from public.locations where organization_id = $1 and is_primary`, [input.organizationId])).rows[0];
    if (input.apply.address && s.address && loc) {
      await q.query(`update public.locations set address_line = coalesce($2, address_line), city = coalesce($3, city), postcode = coalesce($4, postcode) where id = $1`, [loc.id, s.address.line, s.address.city, s.address.postcode]);
      applied.push('address');
    }
    if (input.apply.phone && s.phone) {
      const e = toE164(s.phone, input.country);
      if (e) {
        await q.query(`update public.organizations set contact_phone_e164 = $2 where id = $1`, [input.organizationId, e]);
        applied.push('phone');
      }
    }
    if (input.apply.hours && s.hours.length && loc) {
      await q.query(`delete from public.business_hours where location_id = $1`, [loc.id]);
      for (const h of s.hours) {
        await q.query(`insert into public.business_hours (organization_id, location_id, weekday, opens, closes) values ($1, $2, $3, $4, $5)`, [input.organizationId, loc.id, h.weekday, h.opens, h.closes]);
      }
      applied.push('hours');
    }
    const lang = (await q.query(`select primary_language from public.organizations where id = $1`, [input.organizationId])).rows[0].primary_language as 'en' | 'hr';
    for (const name of input.apply.services) {
      const svc = s.services.find((x) => x.name === name);
      if (!svc) continue;
      const exists = await q.query(`select id from public.services where organization_id = $1 and lower(names ->> $2) = lower($3)`, [input.organizationId, lang, svc.name]);
      if (exists.rows[0]) {
        await q.query(`update public.services set price_minor = $2, price_is_from = $3, price_approved = false where id = $1`, [exists.rows[0].id, svc.priceMinor, svc.priceIsFrom]);
      } else {
        await q.query(
          `insert into public.services (organization_id, names, duration_min, price_minor, price_is_from, price_approved) values ($1, $2, 30, $3, $4, false)`,
          [input.organizationId, JSON.stringify({ [lang]: svc.name }), svc.priceMinor, svc.priceIsFrom],
        );
      }
      applied.push(`service:${svc.name}`);
    }
    await q.query(
      `update public.onboarding_sessions set answers = answers || jsonb_build_object('website_import_applied', $2::jsonb) where organization_id = $1`,
      [input.organizationId, JSON.stringify({ at: new Date().toISOString(), applied })],
    );
  }, { actorUserId: input.actorUserId });
  return { applied };
}
