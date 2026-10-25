import { DateTime } from 'luxon';
import { billableMinutes, previewInvoice, usageAlertLevel, type Plan } from '@vp/core';
import { Lamp } from '@/components/lamp';
import { Empty, PageHeader } from '@/components/page-header';
import { requireMembership } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { openPortal, startCheckout } from './actions';

export const metadata = { title: 'Billing' };

const eur = (minor: number) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(minor / 100);
const STATUS: Record<string, { tone: 'green' | 'blue' | 'amber' | 'red' | 'off'; label: string }> = {
  active: { tone: 'green', label: 'Active' },
  trialing: { tone: 'blue', label: 'Free trial' },
  past_due: { tone: 'amber', label: 'Payment overdue' },
  unpaid: { tone: 'red', label: 'Unpaid' },
  canceled: { tone: 'off', label: 'Cancelled' },
  incomplete: { tone: 'off', label: 'Not started' },
};

export default async function BillingPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ checkout?: string }> }) {
  const { slug } = await params;
  const { checkout } = await searchParams;
  const m = await requireMembership(slug, ['owner', 'manager']);
  const sb = await supabaseServer();
  const month = DateTime.now().startOf('month').toISODate();
  const [sub, plans, usage, invoices] = await Promise.all([
    sb.from('subscriptions').select('plan_code, status, current_period_end, cancel_at_period_end, past_due_since').eq('organization_id', m.organizationId).maybeSingle(),
    sb.from('plans').select('*').order('price_minor'),
    sb.from('usage_monthly').select('calls, call_seconds, bookings').eq('organization_id', m.organizationId).eq('month', month).maybeSingle(),
    sb.from('invoices').select('id, number, status, amount_due_minor, created_at, hosted_invoice_url').eq('organization_id', m.organizationId).order('created_at', { ascending: false }).limit(24),
  ]);
  const s = sub.data;
  const planRow = plans.data?.find((p: any) => p.code === s?.plan_code);
  const plan: Plan | null = planRow
    ? { code: planRow.code, name: planRow.name, priceMinor: planRow.price_minor, currency: 'EUR', includedMinutes: planRow.included_minutes, overagePerMinuteMinor: planRow.overage_per_minute_minor, includedPhoneNumbers: planRow.included_phone_numbers, includedLocations: planRow.included_locations, includedAgents: planRow.included_agents, allowedCapabilities: planRow.allowed_capabilities, hardMinuteCap: planRow.hard_minute_cap, supportTier: planRow.support_tier }
    : null;
  const seconds = Number(usage.data?.call_seconds ?? 0);
  const mins = billableMinutes({ billableSeconds: seconds });
  const alert = plan ? usageAlertLevel(plan, { billableSeconds: seconds }) : 'none';
  const preview = plan ? previewInvoice(plan, { billableSeconds: seconds }) : [];
  const st = STATUS[s?.status ?? 'incomplete']!;
  const isOwner = m.role === 'owner';

  return (
    <>
      <PageHeader title="Billing" detail="Your plan, this month’s call minutes and your invoices." />
      {checkout === 'success' ? <p role="status" className="mb-4 rounded-md bg-lamp-green-wash px-4 py-2">Thanks — your subscription is being set up. This page updates within a minute.</p> : null}
      {checkout === 'unavailable' ? <p role="status" className="mb-4 rounded-md bg-lamp-amber-wash px-4 py-2 text-lamp-amber-ink">Online payment isn’t switched on yet. Contact us to set up your plan.</p> : null}
      {s?.status === 'past_due' ? (
        <p className="mb-4 rounded-md border border-lamp-amber bg-lamp-amber-wash px-4 py-3 text-lamp-amber-ink">
          We couldn’t take your last payment. Your assistant keeps answering calls for 14 days from the first failed payment; after that it only takes messages until the payment goes through.
        </p>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-2">
        <section aria-labelledby="h-plan">
          <h2 id="h-plan" className="mb-2">Plan</h2>
          <div className="sheet grid gap-3 p-4">
            <div className="flex items-center justify-between">
              <span className="text-[1.1rem] font-semibold">{plan?.name ?? 'No plan yet'}</span>
              <Lamp tone={st.tone}>{st.label}</Lamp>
            </div>
            {plan ? <p className="text-ink-soft">{eur(plan.priceMinor)} a month, {plan.includedMinutes} call minutes included, then {eur(plan.overagePerMinuteMinor)} a minute.</p> : null}
            {s?.current_period_end ? <p className="text-[0.9rem] text-ink-faint">{s.cancel_at_period_end ? 'Ends' : 'Renews'} on {DateTime.fromISO(s.current_period_end).toFormat('d LLLL yyyy')}</p> : null}
            {isOwner && s?.status && s.status !== 'incomplete' ? (
              <form action={openPortal.bind(null, slug)}><button className="btn btn-quiet">Manage payment details and plan</button></form>
            ) : null}
          </div>
        </section>

        <section aria-labelledby="h-usage">
          <h2 id="h-usage" className="mb-2">This month</h2>
          <div className="sheet grid gap-2 p-4">
            <p className="tnum text-[1.4rem] font-semibold">{mins} {plan ? <span className="text-[1rem] font-normal text-ink-soft">of {plan.includedMinutes} minutes</span> : 'minutes'}</p>
            {plan && plan.includedMinutes > 0 ? (
              <div className="h-2 overflow-hidden rounded-full bg-ground" role="img" aria-label={`${Math.min(100, Math.round((mins / plan.includedMinutes) * 100))}% of included minutes used`}>
                <div className={`h-full ${alert === 'none' ? 'bg-action' : 'bg-lamp-amber'}`} style={{ width: `${Math.min(100, (mins / plan.includedMinutes) * 100)}%` }} />
              </div>
            ) : null}
            <p className="text-ink-soft">{usage.data?.calls ?? 0} calls, {usage.data?.bookings ?? 0} bookings made by phone.</p>
            {preview.length > 1 ? <p className="text-lamp-amber-ink">Extra minutes so far: {eur(preview[1]!.amountMinor)}</p> : null}
          </div>
        </section>
      </div>

      {isOwner && (!s?.status || s.status === 'incomplete' || s.status === 'canceled') ? (
        <section aria-labelledby="h-choose" className="mt-10">
          <h2 id="h-choose" className="mb-2">Choose a plan</h2>
          <div className="sheet divide-y divide-rule">
            {(plans.data ?? []).filter((p: any) => p.active && p.is_public).map((p: any) => (
              <form key={p.code} action={startCheckout.bind(null, slug)} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <input type="hidden" name="plan" value={p.code} />
                <div>
                  <p className="font-semibold">{p.name}</p>
                  <p className="text-ink-soft">{eur(p.price_minor)} a month · {p.included_minutes} minutes included · {eur(p.overage_per_minute_minor)} per extra minute</p>
                </div>
                <button className="btn btn-primary">Choose {p.name}</button>
              </form>
            ))}
            {!(plans.data ?? []).some((p: any) => p.active && p.is_public) ? <Empty title="Plans aren’t available to choose online yet." /> : null}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="h-inv" className="mt-10">
        <h2 id="h-inv" className="mb-2">Invoices</h2>
        <div className="sheet">
          {!invoices.data?.length ? (
            <Empty title="No invoices yet." />
          ) : (
            <table className="table">
              <thead><tr><th>Date</th><th>Number</th><th>Amount</th><th>Status</th></tr></thead>
              <tbody>
                {invoices.data.map((i: any) => (
                  <tr key={i.id}>
                    <td className="tnum">{DateTime.fromISO(i.created_at).toFormat('d LLL yyyy')}</td>
                    <td>{i.hosted_invoice_url ? <a className="text-action-ink hover:underline" href={i.hosted_invoice_url} target="_blank" rel="noreferrer">{i.number ?? 'View'}</a> : i.number}</td>
                    <td className="tnum">{eur(i.amount_due_minor)}</td>
                    <td>{i.status === 'paid' ? <Lamp tone="green">Paid</Lamp> : i.status === 'open' ? <Lamp tone="amber">Due</Lamp> : i.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </>
  );
}
