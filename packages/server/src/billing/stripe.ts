import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Db } from '../db';

/** Stripe form encoding (nested objects/arrays with bracket keys). */
export function stripeForm(obj: Record<string, unknown>, prefix = ''): URLSearchParams {
  const out = new URLSearchParams();
  const add = (key: string, v: unknown) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) v.forEach((item, i) => add(`${key}[${i}]`, item));
    else if (typeof v === 'object') for (const [k, vv] of Object.entries(v as Record<string, unknown>)) add(`${key}[${k}]`, vv);
    else out.append(key, String(v));
  };
  for (const [k, v] of Object.entries(obj)) add(prefix ? `${prefix}[${k}]` : k, v);
  return out;
}

/**
 * Stripe webhook verification: HMAC-SHA256(secret, `${t}.${rawBody}`) hex, matched against any v1 in the header,
 * with a replay window. Must be given the RAW body exactly as received.
 */
export function verifyStripeSignature(rawBody: string, header: string | null | undefined, secret: string, toleranceSec = 300, nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (!header) return false;
  const parts = header.split(',').map((p) => p.split('=') as [string, string]);
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!Number.isFinite(t) || !sigs.length || Math.abs(nowSec - t) > toleranceSec) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex'));
  return sigs.some((s) => {
    const got = Buffer.from(s);
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

export class StripeClient {
  constructor(private readonly opts: { secretKey: string; fetch?: typeof fetch; apiVersion?: string }) {}

  async call<T = any>(method: 'GET' | 'POST' | 'DELETE', path: string, params: Record<string, unknown> = {}, idempotencyKey?: string): Promise<T> {
    const form = stripeForm(params);
    const url = method === 'GET' && [...form].length ? `https://api.stripe.com${path}?${form}` : `https://api.stripe.com${path}`;
    const res = await (this.opts.fetch ?? fetch)(url, {
      method,
      signal: AbortSignal.timeout(10_000),
      headers: {
        authorization: `Bearer ${this.opts.secretKey}`,
        'content-type': 'application/x-www-form-urlencoded',
        ...(this.opts.apiVersion ? { 'Stripe-Version': this.opts.apiVersion } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: method === 'GET' ? undefined : form,
    });
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      const err = new Error(`Stripe ${res.status}: ${json?.error?.message ?? 'error'}`) as Error & { status?: number; code?: string };
      err.status = res.status;
      err.code = json?.error?.code;
      throw err;
    }
    return json as T;
  }
}

export interface BillingConfig {
  stripe: StripeClient;
  siteUrl: string;
  meterEventName: string; // the event_name configured on the Stripe meter (value = call seconds)
  automaticTax: boolean; // requires Stripe Tax to be configured on the account (tax adviser review)
}

async function orgBilling(db: Db, organizationId: string) {
  const { rows } = await db.query(
    `select o.id, o.name, o.slug, o.contact_email, o.country, s.stripe_customer_id, s.stripe_subscription_id, s.plan_code, s.status
       from public.organizations o left join public.subscriptions s on s.organization_id = o.id where o.id = $1`,
    [organizationId],
  );
  if (!rows[0]) throw new Error('Organization not found');
  return rows[0];
}

export async function ensureStripeCustomer(db: Db, cfg: BillingConfig, organizationId: string): Promise<string> {
  const o = await orgBilling(db, organizationId);
  if (o.stripe_customer_id) return o.stripe_customer_id;
  const c = await cfg.stripe.call('POST', '/v1/customers', {
    name: o.name,
    email: o.contact_email ?? undefined,
    address: { country: o.country },
    metadata: { organization_id: organizationId },
    preferred_locales: [o.country === 'HR' ? 'hr' : 'en'],
  }, `customer:${organizationId}`);
  await db.query(
    `insert into public.subscriptions (organization_id, plan_code, status, stripe_customer_id) values ($1, coalesce($2, 'starter'), 'incomplete', $3)
     on conflict (organization_id) do update set stripe_customer_id = excluded.stripe_customer_id`,
    [organizationId, o.plan_code, c.id],
  );
  return c.id;
}

/** Stripe-hosted checkout for a plan. Plans hold the Stripe price ids; the meter price handles included minutes + overage tiers. */
export async function createCheckout(db: Db, cfg: BillingConfig, input: { organizationId: string; planCode: string }): Promise<string> {
  const { rows } = await db.query(`select code, stripe_price_id, stripe_overage_price_id, active from public.plans where code = $1`, [input.planCode]);
  const plan = rows[0];
  if (!plan?.active || !plan.stripe_price_id) throw new Error('This plan is not available for sign-up yet.');
  const o = await orgBilling(db, input.organizationId);
  const customer = await ensureStripeCustomer(db, cfg, input.organizationId);
  const session = await cfg.stripe.call('POST', '/v1/checkout/sessions', {
    mode: 'subscription',
    customer,
    line_items: [{ price: plan.stripe_price_id, quantity: 1 }, ...(plan.stripe_overage_price_id ? [{ price: plan.stripe_overage_price_id }] : [])],
    success_url: `${cfg.siteUrl}/app/${o.slug}/billing?checkout=success`,
    cancel_url: `${cfg.siteUrl}/app/${o.slug}/billing?checkout=cancelled`,
    automatic_tax: { enabled: cfg.automaticTax },
    tax_id_collection: { enabled: true },
    customer_update: { address: 'auto', name: 'auto' },
    billing_address_collection: 'required',
    subscription_data: { metadata: { organization_id: input.organizationId, plan_code: input.planCode } },
    metadata: { organization_id: input.organizationId, plan_code: input.planCode },
  });
  return session.url as string;
}

export async function createPortal(db: Db, cfg: BillingConfig, organizationId: string): Promise<string> {
  const o = await orgBilling(db, organizationId);
  const customer = await ensureStripeCustomer(db, cfg, organizationId);
  const s = await cfg.stripe.call('POST', '/v1/billing_portal/sessions', { customer, return_url: `${cfg.siteUrl}/app/${o.slug}/billing` });
  return s.url as string;
}

type StripeEvent = { id: string; type: string; created: number; data: { object: any } };

const SUB_STATUS: Record<string, string> = {
  trialing: 'trialing', active: 'active', past_due: 'past_due', unpaid: 'unpaid', canceled: 'canceled',
  incomplete: 'incomplete', incomplete_expired: 'canceled', paused: 'past_due',
};

/**
 * Applies a verified Stripe event. Idempotent (webhook_events unique key) and order-safe
 * (subscription changes older than the last one applied are ignored).
 */
export async function handleStripeEvent(db: Db, event: StripeEvent, opts: { siteUrl: string }): Promise<'processed' | 'duplicate' | 'ignored'> {
  const inserted = await db.query(
    `insert into public.webhook_events (provider, event_id, event_type, signature_valid, payload) values ('stripe', $1, $2, true, $3)
     on conflict (provider, event_id) do nothing returning id`,
    [event.id, event.type, JSON.stringify(event)],
  );
  if (!inserted.rows[0]) return 'duplicate';
  const webhookId = inserted.rows[0].id;
  const obj = event.data.object;
  let outcome: 'processed' | 'ignored' = 'processed';
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const org = obj.metadata?.organization_id;
        if (!org) {
          outcome = 'ignored';
          break;
        }
        await db.query(
          `update public.subscriptions set stripe_customer_id = coalesce(stripe_customer_id, $2), stripe_subscription_id = $3, plan_code = coalesce($4, plan_code)
            where organization_id = $1`,
          [org, obj.customer, obj.subscription, obj.metadata?.plan_code ?? null],
        );
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const org = obj.metadata?.organization_id ?? (await db.query(`select organization_id from public.subscriptions where stripe_customer_id = $1`, [obj.customer])).rows[0]?.organization_id;
        if (!org) {
          outcome = 'ignored';
          break;
        }
        const status = event.type === 'customer.subscription.deleted' ? 'canceled' : SUB_STATUS[obj.status] ?? 'incomplete';
        const priceIds: string[] = (obj.items?.data ?? []).map((i: any) => i.price?.id).filter(Boolean);
        const plan = priceIds.length ? (await db.query(`select code from public.plans where stripe_price_id = any($1) limit 1`, [priceIds])).rows[0]?.code : null;
        const item = obj.items?.data?.[0];
        const periodStart = obj.current_period_start ?? item?.current_period_start;
        const periodEnd = obj.current_period_end ?? item?.current_period_end;
        const res = await db.query(
          `update public.subscriptions set
             status = $2, stripe_subscription_id = $3, plan_code = coalesce($4, plan_code),
             current_period_start = to_timestamp($5), current_period_end = to_timestamp($6),
             trial_ends_at = to_timestamp($7), cancel_at_period_end = $8,
             past_due_since = case when $2 in ('past_due', 'unpaid') then coalesce(past_due_since, now()) else null end,
             last_stripe_event_at = to_timestamp($9)
           where organization_id = $1 and (last_stripe_event_at is null or last_stripe_event_at <= to_timestamp($9))`,
          [org, status, obj.id, plan, periodStart ?? null, periodEnd ?? null, obj.trial_end ?? null, !!obj.cancel_at_period_end, event.created],
        );
        if (!res.rowCount) {
          outcome = 'ignored'; // older than what we already applied
          break;
        }
        // Paying customers who were trialling become active; never auto-activate one still onboarding.
        if (status === 'active') await db.query(`update public.organizations set status = 'active' where id = $1 and status in ('trial', 'suspended')`, [org]);
        if (status === 'trialing') await db.query(`update public.organizations set status = 'trial' where id = $1 and status = 'suspended'`, [org]);
        break;
      }
      case 'invoice.finalized':
      case 'invoice.paid':
      case 'invoice.payment_failed':
      case 'invoice.voided': {
        const org = (await db.query(`select organization_id from public.subscriptions where stripe_customer_id = $1`, [obj.customer])).rows[0]?.organization_id;
        if (!org) {
          outcome = 'ignored';
          break;
        }
        await db.query(
          `insert into public.invoices (organization_id, stripe_invoice_id, status, number, amount_due_minor, amount_paid_minor, currency, period_start, period_end, hosted_invoice_url, invoice_pdf_url)
           values ($1, $2, $3, $4, $5, $6, upper($7), to_timestamp($8), to_timestamp($9), $10, $11)
           on conflict (stripe_invoice_id) do update set status = excluded.status, amount_paid_minor = excluded.amount_paid_minor,
             hosted_invoice_url = excluded.hosted_invoice_url, invoice_pdf_url = excluded.invoice_pdf_url, number = excluded.number`,
          [org, obj.id, obj.status, obj.number, obj.amount_due ?? 0, obj.amount_paid ?? 0, obj.currency ?? 'eur', obj.period_start ?? null, obj.period_end ?? null, obj.hosted_invoice_url ?? null, obj.invoice_pdf ?? null],
        );
        if (event.type === 'invoice.payment_failed') {
          const o = (await db.query(`select name, slug, contact_email, primary_language from public.organizations where id = $1`, [org])).rows[0];
          if (o?.contact_email) {
            const en = o.primary_language !== 'hr';
            await db.query(
              `insert into public.notifications (organization_id, channel, template, language, recipient, dedupe_key, payload)
               values ($1, 'email', 'payment_failed', $2, $3, $4, $5) on conflict do nothing`,
              [org, o.primary_language, o.contact_email, `payment_failed:${obj.id}:${obj.attempt_count ?? 1}`, JSON.stringify({
                subject: en ? `Payment failed: ${o.name}` : `Plaćanje nije uspjelo: ${o.name}`,
                text: en
                  ? `We couldn't take your payment. Your phone assistant keeps working for now. Please update your payment details: ${opts.siteUrl}/app/${o.slug}/billing`
                  : `Plaćanje nije uspjelo. Vaš asistent za sada i dalje radi. Molimo ažurirajte podatke o plaćanju: ${opts.siteUrl}/app/${o.slug}/billing`,
              })],
            );
            const n = (await db.query(`select id from public.notifications where organization_id = $1 and dedupe_key = $2`, [org, `payment_failed:${obj.id}:${obj.attempt_count ?? 1}`])).rows[0];
            if (n) await db.query(`insert into public.jobs (kind, organization_id, payload, dedupe_key) values ('deliver_notification', $1, $2, $3) on conflict do nothing`, [org, JSON.stringify({ notificationId: n.id }), `deliver:${n.id}`]);
          }
        }
        break;
      }
      default:
        outcome = 'ignored';
    }
    await db.query(`update public.webhook_events set status = $2, processed_at = now() where id = $1`, [webhookId, outcome]);
    return outcome;
  } catch (e) {
    // Allow Stripe's retry to reprocess: remove the dedupe row, record the failure separately.
    await db.query(`delete from public.webhook_events where id = $1`, [webhookId]);
    await db.query(
      `insert into public.webhook_events (provider, event_id, event_type, signature_valid, payload, status, error) values ('stripe', $1, $2, true, '{}', 'failed', $3)`,
      [`${event.id}:failed:${Date.now()}`, event.type, (e as Error).message.slice(0, 1000)],
    );
    throw e;
  }
}

/**
 * Report unreported call usage to Stripe as meter events (value = seconds). Each usage row has a stable
 * identifier, so a retry after a crash never double-bills.
 */
export async function reportUsageToStripe(db: Db, cfg: BillingConfig, limit = 200): Promise<{ reported: number; skipped: number }> {
  const { rows } = await db.query(
    `select u.id, u.quantity, u.occurred_at, u.idempotency_key, s.stripe_customer_id
       from public.usage_events u join public.subscriptions s on s.organization_id = u.organization_id
      where u.reported_to_stripe_at is null and u.metric = 'call_seconds' and s.stripe_customer_id is not null
        and s.status in ('active', 'trialing', 'past_due') and u.occurred_at > now() - interval '34 days'
      order by u.occurred_at limit $1`,
    [limit],
  );
  let reported = 0;
  for (const r of rows) {
    await cfg.stripe.call('POST', '/v1/billing/meter_events', {
      event_name: cfg.meterEventName,
      identifier: r.idempotency_key,
      timestamp: Math.floor(new Date(r.occurred_at).getTime() / 1000),
      payload: { stripe_customer_id: r.stripe_customer_id, value: String(r.quantity) },
    });
    await db.query(`update public.usage_events set reported_to_stripe_at = now() where id = $1`, [r.id]);
    reported++;
  }
  return { reported, skipped: 0 };
}
