import { DateTime } from 'luxon';
import { Empty, PageHeader } from '@/components/page-header';
import { SettingsTabs } from '@/components/settings-tabs';
import { requireMembership } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { addClosure, removeClosure } from './actions';

export const metadata = { title: 'Closures' };

export default async function ClosuresPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireMembership(slug, ['owner', 'manager']);
  const sb = await supabaseServer();
  const [rows, staff] = await Promise.all([
    sb.from('date_exceptions').select('id, date, closed, ranges, label, staff_id, staff_members(display_name)').eq('organization_id', m.organizationId).gte('date', DateTime.now().toISODate()!).order('date'),
    sb.from('staff_members').select('id, display_name').eq('organization_id', m.organizationId).eq('active', true).order('display_name'),
  ]);
  const remove = removeClosure.bind(null, slug);
  return (
    <>
      <PageHeader title="Settings" detail="Bank holidays, annual leave and one-off changes. Your assistant won’t offer times on these days and tells callers you’re closed." />
      <SettingsTabs slug={slug} active="/closures" />
      <form action={addClosure.bind(null, slug)} className="sheet mb-6 grid gap-3 p-4 sm:grid-cols-[10rem_12rem_10rem_1fr] sm:items-end">
        <label className="field"><span>Date</span><input className="input tnum" type="date" name="date" required min={DateTime.now().toISODate()!} /></label>
        <label className="field">
          <span>Who</span>
          <select className="input" name="staffId" defaultValue="">
            <option value="">Whole business</option>
            {(staff.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.display_name} only</option>)}
          </select>
        </label>
        <label className="field">
          <span>What</span>
          <select className="input" name="kind" defaultValue="closed"><option value="closed">Closed all day</option><option value="special">Different hours</option></select>
        </label>
        <div className="flex flex-wrap items-end gap-2">
          <input aria-label="Opens" className="input tnum w-[6.5rem]" type="time" name="opens" />
          <input aria-label="Closes" className="input tnum w-[6.5rem]" type="time" name="closes" />
          <input aria-label="Note" className="input min-w-[8rem] flex-1" name="label" placeholder="e.g. St Patrick’s Day" maxLength={80} />
          <button className="btn btn-primary">Add</button>
        </div>
      </form>
      <div className="sheet">
        {!rows.data?.length ? <Empty title="No upcoming closures." /> : (
          <ul className="divide-y divide-rule">
            {rows.data.map((r: any) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <span>
                  <span className="tnum font-medium">{DateTime.fromISO(r.date).toFormat('ccc d LLL yyyy')}</span>
                  <span className="ml-3 text-ink-soft">{r.staff_members?.display_name ? `${r.staff_members.display_name}: ` : ''}{r.closed ? 'closed' : `open ${r.ranges.map((x: any) => `${x.start}–${x.end}`).join(', ')}`}{r.label ? ` · ${r.label}` : ''}</span>
                </span>
                <form action={remove}><input type="hidden" name="id" value={r.id} /><button className="btn btn-quiet">Remove</button></form>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
