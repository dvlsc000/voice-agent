import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
import {
  Db,
  StripeClient,
  createCheckout,
  finalizeCall,
  handleStripeEvent,
  provisionClient,
  reportUsageToStripe,
  startInboundCall,
  stripeForm,
  verifyStripeSignature,
  type BillingConfig,
} from '../src/index';

const db = Db.fromUrl(process.env.DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:54329/postgres');
let org: string;
const calls: Array<{ path: string; body: string; idem?: string }> = [];
const fakeStripe: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  calls.push({ path: url.pathname, body: String(init?.body ?? ''), idem: (init?.headers as Record<string, string>)['Idempotency-Key'] });
  const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
  if (url.pathname === '/v1/customers') return json({ id: 'cus_123' });
  if (url.pathname === '/v1/checkout/sessions') return json({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' });
  if (url.pathname === '/v1/billing/meter_events') return json({ identifier: 'x' });
  return new Response('{}', { status: 404 });
};
const cfg: BillingConfig = { stripe: new StripeClient({ secretKey: 'sk_test_x', fetch: fakeStripe }), siteUrl: 'https://app.test', meterEventName: 'call_seconds', automaticTax: false };

beforeAll(async () => {
  const r = await provisionClient(db, {
    businessName: 'Billing Barbers', industry: 'barbershop', country: 'IE', primaryLanguage: 'en', contactEmail: 'o@b.test', ownerEmail: 'o@b.test',
    hours: [{ weekday: 1, opens: '09:00', closes: '17:00' }], staff: [{ name: 'Mark' }],
  }, { actorUserId: null, idempotencyKey: randomUUID() });
  org = r.organizationId;
  await db.query(`update public.organizations set status = 'trial' where id = $1`, [org]);
  await db.query(`update public.plans set price_minor = 9900, included_minutes = 300, overage_per_minute_minor = 30, stripe_price_id = 'price_base', stripe_overage_price_id = 'price_meter', active = true where code = 'starter'`);
});
afterAll(async () => {
  await db.query(`update public.plans set active = false, price_minor = 0, stripe_price_id = null, stripe_overage_price_id = null where code = 'starter'`);
  await db.end();
});

const sign = (body: string, secret: string, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

describe('Stripe webhook signatures', () => {
  const body = JSON.stringify({ id: 'evt_1' });
  it('accepts a valid signature and rejects tampering, wrong secrets and replays', () => {
    expect(verifyStripeSignature(body, sign(body, 'whsec_a'), 'whsec_a')).toBe(true);
    expect(verifyStripeSignature(body + ' ', sign(body, 'whsec_a'), 'whsec_a')).toBe(false);
    expect(verifyStripeSignature(body, sign(body, 'whsec_b'), 'whsec_a')).toBe(false);
    expect(verifyStripeSignature(body, sign(body, 'whsec_a', Math.floor(Date.now() / 1000) - 3600), 'whsec_a')).toBe(false);
    expect(verifyStripeSignature(body, null, 'whsec_a')).toBe(false);
  });
  it('accepts when any of several v1 signatures matches (secret rotation)', () => {
    const t = Math.floor(Date.now() / 1000);
    const good = createHmac('sha256', 'whsec_new').update(`${t}.${body}`).digest('hex');
    expect(verifyStripeSignature(body, `t=${t},v1=deadbeef,v1=${good}`, 'whsec_new')).toBe(true);
  });
});

describe('Stripe billing flows', () => {
  it('encodes nested params the way Stripe expects', () => {
    expect(stripeForm({ line_items: [{ price: 'p', quantity: 1 }], metadata: { organization_id: 'o' } }).toString()).toBe(
      'line_items%5B0%5D%5Bprice%5D=p&line_items%5B0%5D%5Bquantity%5D=1&metadata%5Borganization_id%5D=o',
    );
  });

  it('checkout creates one customer (idempotently) and a subscription session for the plan', async () => {
    const url = await createCheckout(db, cfg, { organizationId: org, planCode: 'starter' });
    expect(url).toMatch(/^https:\/\/checkout\.stripe\.com/);
    const custCall = calls.find((c) => c.path === '/v1/customers')!;
    expect(custCall.idem).toBe(`customer:${org}`);
    const session = new URLSearchParams(calls.find((c) => c.path === '/v1/checkout/sessions')!.body);
    expect(session.get('mode')).toBe('subscription');
    expect(session.get('line_items[0][price]')).toBe('price_base');
    expect(session.get('line_items[1][price]')).toBe('price_meter');
    expect(session.get('tax_id_collection[enabled]')).toBe('true');
    await expect(createCheckout(db, cfg, { organizationId: org, planCode: 'professional' })).rejects.toThrow(/not available/);
  });

  const subEvent = (id: string, status: string, created: number) => ({
    id, type: 'customer.subscription.updated', created,
    data: { object: { id: 'sub_1', customer: 'cus_123', status, metadata: { organization_id: org }, cancel_at_period_end: false, current_period_start: created, current_period_end: created + 2592000, items: { data: [{ price: { id: 'price_base' } }] } } },
  });

  it('applies subscription events once, in order, and activates a paying trial', async () => {
    const t = Math.floor(Date.now() / 1000);
    expect(await handleStripeEvent(db, subEvent('evt_a', 'active', t), { siteUrl: 'x' })).toBe('processed');
    expect(await handleStripeEvent(db, subEvent('evt_a', 'active', t), { siteUrl: 'x' })).toBe('duplicate');
    const o = await db.query(`select status from public.organizations where id = $1`, [org]);
    expect(o.rows[0].status).toBe('active');
    // A delayed older event must not overwrite newer state.
    expect(await handleStripeEvent(db, subEvent('evt_old', 'incomplete', t - 600), { siteUrl: 'x' })).toBe('ignored');
    const s = await db.query(`select status, plan_code from public.subscriptions where organization_id = $1`, [org]);
    expect(s.rows[0]).toEqual({ status: 'active', plan_code: 'starter' });
  });

  it('a failed payment starts the grace period and emails the owner; the phone keeps working', async () => {
    const t = Math.floor(Date.now() / 1000) + 10;
    await handleStripeEvent(db, subEvent('evt_pd', 'past_due', t), { siteUrl: 'https://app.test' });
    await handleStripeEvent(db, { id: 'evt_inv', type: 'invoice.payment_failed', created: t, data: { object: { id: 'in_1', customer: 'cus_123', status: 'open', amount_due: 9900, currency: 'eur', attempt_count: 1 } } }, { siteUrl: 'https://app.test' });
    const s = await db.query(`select status, past_due_since is not null as grace from public.subscriptions where organization_id = $1`, [org]);
    expect(s.rows[0]).toEqual({ status: 'past_due', grace: true });
    const n = await db.query(`select payload from public.notifications where organization_id = $1 and template = 'payment_failed'`, [org]);
    expect(n.rows[0].payload.text).toMatch(/keeps working/);
    const inv = await db.query(`select amount_due_minor from public.invoices where stripe_invoice_id = 'in_1'`);
    expect(inv.rows[0].amount_due_minor).toBe(9900);
    await handleStripeEvent(db, subEvent('evt_ok', 'active', t + 10), { siteUrl: 'x' });
    const s2 = await db.query(`select past_due_since from public.subscriptions where organization_id = $1`, [org]);
    expect(s2.rows[0].past_due_since).toBeNull();
  });

  it('reports each call’s seconds to Stripe exactly once', async () => {
    const number = `+35391${Math.floor(100000 + Math.random() * 899999)}`;
    const agent = (await db.query(`select id from public.agents where organization_id = $1`, [org])).rows[0].id;
    await db.query(`insert into public.phone_numbers (organization_id, e164, country, connection_type, provider, status, agent_id) values ($1, $2, 'IE', 'provider_number', 'twilio', 'active', $3)`, [org, number, agent]);
    await db.query(`update public.agent_versions set status = 'published', published_at = now() where organization_id = $1`, [org]);
    await db.query(`update public.agents set active_version_id = (select id from public.agent_versions where agent_id = $1 limit 1) where id = $1`, [agent]);
    const d = await startInboundCall(db, { provider: 'twilio', providerCallId: randomUUID(), toE164: number, fromE164: null });
    if (d.type !== 'agent') throw new Error(d.type);
    await finalizeCall(db, d.callId, { durationSec: 95, endedBy: 'caller', outcome: 'info_given', transcript: [], transcriptsEnabled: false, escalationRuleId: null, language: 'en', country: 'IE' });
    calls.length = 0;
    expect((await reportUsageToStripe(db, cfg)).reported).toBe(1);
    expect((await reportUsageToStripe(db, cfg)).reported).toBe(0);
    const ev = new URLSearchParams(calls.find((c) => c.path === '/v1/billing/meter_events')!.body);
    expect(ev.get('payload[value]')).toBe('95');
    expect(ev.get('payload[stripe_customer_id]')).toBe('cus_123');
    expect(ev.get('identifier')).toBe(`call:${d.callId}:seconds`);
  });
});
