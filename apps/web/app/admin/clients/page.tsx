import Link from 'next/link';
import { DateTime } from 'luxon';
import { Lamp } from '@/components/lamp';
import { Empty, PageHeader } from '@/components/page-header';
import { requirePlatformStaff } from '@/lib/auth';
import { serverDb } from '@/lib/db';

export const metadata = { title: 'Clients' };
export const dynamic = 'force-dynamic';

const STATUS_TONE = { active: 'green', trial: 'blue', onboarding: 'amber', suspended: 'red', closed: 'off' } as const;
const STATUS_LABEL = { active: 'Live', trial: 'Trial', onboarding: 'Onboarding', suspended: 'Suspended', closed: 'Closed' } as const;

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requirePlatformStaff();
  const { q } = await searchParams;
  const { rows } = await serverDb().query(
    `select o.id, o.name, o.industry_template_id, o.country, o.status, o.created_at, s.plan_code, s.status as billing,
            (select count(*) from public.calls c where c.organization_id = o.id and c.started_at > now() - interval '30 days')::int as calls_30d
       from public.organizations o left join public.subscriptions s on s.organization_id = o.id
      where ($1::text is null or o.name ilike '%' || $1 || '%')
      order by o.created_at desc limit 200`,
    [q?.trim() || null],
  );
  return (
    <>
      <PageHeader title="Clients" actions={<Link className="btn btn-primary" href="/admin/clients/new">Create client</Link>} />
      <form className="mb-4 max-w-[360px]" role="search">
        <label className="field">
          <span>Search by business name</span>
          <input className="input" name="q" defaultValue={q ?? ''} />
        </label>
      </form>
      <div className="sheet overflow-x-auto">
        {rows.length === 0 ? (
          <Empty title={q ? 'No clients match that name.' : 'No clients yet.'}>{q ? null : 'Create your first client to set up their phone assistant.'}</Empty>
        ) : (
          <table className="table min-w-[680px]">
            <thead>
              <tr><th>Business</th><th>Industry</th><th>Status</th><th>Plan</th><th>Calls, 30 days</th><th>Added</th></tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id} className="hover:bg-ground">
                  <td><Link className="font-medium text-action-ink hover:underline" href={`/admin/clients/${o.id}`}>{o.name}</Link><div className="text-[0.85rem] text-ink-faint">{o.country === 'IE' ? 'Ireland' : 'Croatia'}</div></td>
                  <td>{o.industry_template_id.replace(/_/g, ' ')}</td>
                  <td><Lamp tone={STATUS_TONE[o.status as keyof typeof STATUS_TONE]}>{STATUS_LABEL[o.status as keyof typeof STATUS_LABEL]}</Lamp></td>
                  <td>{o.plan_code ?? '—'}{o.billing === 'past_due' ? <div className="text-[0.85rem] text-lamp-red">Payment overdue</div> : null}</td>
                  <td className="tnum">{o.calls_30d}</td>
                  <td className="tnum text-ink-soft">{DateTime.fromJSDate(o.created_at).toFormat('d LLL yyyy')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
