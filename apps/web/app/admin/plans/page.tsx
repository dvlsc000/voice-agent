import { minimumViablePriceEur } from '@vp/core';
import { PageHeader } from '@/components/page-header';
import { requirePlatformStaff } from '@/lib/auth';
import { serverDb } from '@/lib/db';
import { savePlan } from './actions';

export const metadata = { title: 'Plans' };
export const dynamic = 'force-dynamic';

export default async function PlansPage() {
  await requirePlatformStaff();
  const db = serverDb();
  const { rows } = await db.query(`select * from public.plans order by price_minor, code`);
  const clients = (await db.query(`select count(*)::int as n from public.organizations where status in ('active', 'trial')`)).rows[0].n || 20;
  const floor = (mins: number) => minimumViablePriceEur(mins, { country: 'IE', language: 'en', stack: 'eu_native', llmTier: 'small' }, Math.max(clients, 5), 0.7);
  return (
    <>
      <PageHeader title="Plans" detail="Prices are data: changes apply to new checkouts immediately. Existing subscribers keep their Stripe price until you migrate them in Stripe." />
      <div className="grid gap-6">
        {rows.map((p) => (
          <form key={p.code} action={savePlan} className="sheet grid gap-4 p-4">
            <input type="hidden" name="code" value={p.code} />
            <div className="grid gap-4 sm:grid-cols-4">
              <label className="field"><span>Name</span><input className="input" name="name" defaultValue={p.name} /></label>
              <label className="field"><span>Monthly price (€)</span><input className="input tnum" name="price" defaultValue={(p.price_minor / 100).toFixed(2)} /></label>
              <label className="field"><span>Included minutes</span><input className="input tnum" type="number" min={0} name="includedMinutes" defaultValue={p.included_minutes} /></label>
              <label className="field"><span>Extra minute (€)</span><input className="input tnum" name="overage" defaultValue={(p.overage_per_minute_minor / 100).toFixed(2)} /></label>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="field"><span>Stripe price ID (monthly)</span><input className="input" name="stripePriceId" defaultValue={p.stripe_price_id ?? ''} placeholder="price_..." /></label>
              <label className="field"><span>Stripe price ID (metered minutes)</span><input className="input" name="stripeMeterPriceId" defaultValue={p.stripe_overage_price_id ?? ''} placeholder="price_..." /></label>
            </div>
            <div className="flex flex-wrap items-center gap-5">
              <label className="flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={p.active} className="accent-action" />Available</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="isPublic" defaultChecked={p.is_public} className="accent-action" />Shown to clients</label>
              <span className="text-[0.85rem] text-ink-faint">
                Cost floor for a 70% margin at {p.included_minutes} minutes: €{floor(p.included_minutes)}/month (Irish English calls, model in docs/cost-model.md — several inputs still unverified).
              </span>
              <button className="btn btn-primary ml-auto">Save {p.name}</button>
            </div>
          </form>
        ))}
      </div>
    </>
  );
}
