import { DateTime } from 'luxon';
import { PageHeader } from '@/components/page-header';
import { requirePlatformStaff } from '@/lib/auth';
import { serverDb } from '@/lib/db';

export const metadata = { title: 'Overview' };
export const dynamic = 'force-dynamic';

export default async function AdminOverview() {
  await requirePlatformStaff();
  const db = serverDb();
  const monthStart = DateTime.utc().startOf('month').toISO();
  const { rows } = await db.query(
    `select
       (select count(*) from public.organizations where status <> 'closed')::int as clients,
       (select count(*) from public.organizations where status = 'active')::int as active,
       (select count(*) from public.organizations where status = 'trial')::int as trial,
       (select count(*) from public.organizations where status = 'onboarding')::int as onboarding,
       (select coalesce(sum(p.price_minor), 0) from public.subscriptions s join public.plans p on p.code = s.plan_code where s.status in ('active', 'past_due'))::bigint as mrr_minor,
       (select count(*) from public.calls where started_at >= $1)::int as calls,
       (select coalesce(sum(duration_sec), 0) from public.calls where started_at >= $1)::bigint as seconds,
       (select count(*) from public.appointments where created_at >= $1 and source = 'voice' and status in ('confirmed', 'completed', 'no_show', 'cancelled'))::int as bookings,
       (select count(*) from public.appointments where created_at >= $1 and source = 'voice' and status in ('failed', 'needs_reconciliation'))::int as failed_bookings,
       (select coalesce(sum(amount_micros), 0) from public.provider_cost_events where occurred_at >= $1)::bigint as cost_micros,
       (select count(*) from public.incidents where status <> 'resolved')::int as incidents,
       (select count(*) from public.jobs where status = 'dead')::int as dead_jobs,
       (select count(*) from public.webhook_events where status = 'failed' and received_at >= now() - interval '7 days')::int as webhook_failures`,
    [monthStart],
  );
  const r = rows[0];
  const eur = (minor: number) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(minor / 100);
  const usd = (micros: number) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'USD' }).format(micros / 1e6);
  const minutes = Math.round(Number(r.seconds) / 60);
  const health = [
    { label: 'Open incidents', value: r.incidents },
    { label: 'Failed background jobs', value: r.dead_jobs },
    { label: 'Failed webhooks, 7 days', value: r.webhook_failures },
    { label: 'Bookings that did not complete', value: r.failed_bookings },
  ];
  const figures = [
    ['Clients', `${r.clients}`, `${r.active} live, ${r.trial} on trial, ${r.onboarding} onboarding`],
    ['Monthly recurring revenue', eur(Number(r.mrr_minor)), 'from active and past-due subscriptions'],
    ['Calls this month', `${r.calls}`, `${minutes.toLocaleString('en-IE')} minutes`],
    ['Bookings made by phone', `${r.bookings}`, 'this month'],
    ['Provider costs', usd(Number(r.cost_micros)), minutes ? `${usd((Number(r.cost_micros) / minutes))} per minute, estimated until reconciled` : 'no traffic yet'],
  ];
  return (
    <>
      <PageHeader title="Overview" detail={`This month so far, ${DateTime.now().toFormat('LLLL yyyy')}.`} />
      <section aria-labelledby="h-health" className="mb-8">
        <h2 id="h-health" className="mb-2">Needs attention</h2>
        <ul className="sheet divide-y divide-rule">
          {health.map((h) => (
            <li key={h.label} className="flex items-center justify-between px-4 py-2.5">
              <span>{h.label}</span>
              <span className={`tnum font-semibold ${h.value > 0 ? 'text-lamp-amber-ink' : 'text-ink-faint'}`}>{h.value}</span>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="h-biz">
        <h2 id="h-biz" className="mb-2">Business</h2>
        <dl className="sheet divide-y divide-rule">
          {figures.map(([label, value, note]) => (
            <div key={label} className="grid gap-1 px-4 py-3 sm:grid-cols-[16rem_10rem_1fr] sm:items-baseline">
              <dt className="text-ink-soft">{label}</dt>
              <dd className="tnum text-[1.15rem] font-semibold">{value}</dd>
              <dd className="text-[0.85rem] text-ink-faint">{note}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-[0.85rem] text-ink-faint">Gross margin appears once plans have prices and provider costs are recorded per call.</p>
      </section>
    </>
  );
}
