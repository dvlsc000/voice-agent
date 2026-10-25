import { PageHeader } from '@/components/page-header';
import { SettingsTabs } from '@/components/settings-tabs';
import { requireMembership } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { addStaff, saveStaff } from './actions';

export const metadata = { title: 'Staff' };
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default async function StaffPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireMembership(slug, ['owner', 'manager']);
  const sb = await supabaseServer();
  const [staff, hours, org] = await Promise.all([
    sb.from('staff_members').select('id, display_name, aliases, bookable, active, transfer_phone_e164').eq('organization_id', m.organizationId).order('display_name'),
    sb.from('staff_hours').select('staff_id, weekday, starts, ends').eq('organization_id', m.organizationId),
    sb.from('organizations').select('country').eq('id', m.organizationId).single(),
  ]);
  const save = saveStaff.bind(null, slug);
  return (
    <>
      <PageHeader title="Settings" detail="Who callers can book with, and when each person works." />
      <SettingsTabs slug={slug} active="/staff" />
      <div className="grid gap-4">
        {(staff.data ?? []).map((s) => {
          const mine = (hours.data ?? []).filter((h) => h.staff_id === s.id);
          return (
            <form key={s.id} action={save} className="sheet grid gap-4 p-4">
              <input type="hidden" name="id" value={s.id} />
              <input type="hidden" name="country" value={org.data?.country ?? 'IE'} />
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="field"><span>Name</span><input className="input" name="name" defaultValue={s.display_name} required /></label>
                <label className="field"><span>Other names callers use</span><input className="input" name="aliases" defaultValue={(s.aliases ?? []).join(', ')} placeholder="Marko, Mark" /></label>
                <label className="field"><span>Transfer number (optional)</span><input className="input tnum" name="transferPhone" defaultValue={s.transfer_phone_e164 ?? ''} /></label>
              </div>
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-[0.85rem] font-semibold text-ink-soft">Working hours</legend>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {DAYS.map((d, i) => {
                    const h = mine.find((x) => x.weekday === i + 1);
                    return (
                      <div key={d} className="flex items-center gap-2">
                        <label className="flex w-14 items-center gap-1.5"><input type="checkbox" name={`on-${i + 1}`} defaultChecked={!!h} className="accent-action" />{d}</label>
                        <input aria-label={`${d} start`} className="input tnum w-[6.5rem]" type="time" name={`s-${i + 1}`} defaultValue={h?.starts?.slice(0, 5) ?? '09:00'} />
                        <input aria-label={`${d} end`} className="input tnum w-[6.5rem]" type="time" name={`e-${i + 1}`} defaultValue={h?.ends?.slice(0, 5) ?? '17:00'} />
                      </div>
                    );
                  })}
                </div>
              </fieldset>
              <div className="flex flex-wrap items-center gap-5">
                <label className="flex items-center gap-2"><input type="checkbox" name="bookable" defaultChecked={s.bookable} className="accent-action" />Callers can book with {s.display_name}</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={s.active} className="accent-action" />Still works here</label>
                <button className="btn btn-quiet ml-auto">Save {s.display_name}</button>
              </div>
            </form>
          );
        })}
        <form action={addStaff.bind(null, slug)} className="sheet flex flex-wrap items-end gap-3 p-4">
          <label className="field grow"><span>Add a person</span><input className="input" name="name" placeholder="Name" required /></label>
          <button className="btn btn-primary">Add</button>
        </form>
      </div>
    </>
  );
}
