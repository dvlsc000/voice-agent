import { PageHeader } from '@/components/page-header';
import { requireMembership } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { saveHours, saveService } from './actions';
import { HoursForm } from './hours-form';
import { CalendarSection } from './calendar-section';

export const metadata = { title: 'Settings' };

export default async function SettingsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ calendar?: string }> }) {
  const { slug } = await params;
  const { calendar } = await searchParams;
  const m = await requireMembership(slug, ['owner', 'manager']);
  const sb = await supabaseServer();
  const [hours, services] = await Promise.all([
    sb.from('business_hours').select('weekday, opens, closes').eq('organization_id', m.organizationId).order('weekday'),
    sb.from('services').select('id, names, duration_min, price_minor, price_approved, active').eq('organization_id', m.organizationId).order('sort_order'),
  ]);
  const initial: Record<number, { opens: string; closes: string }> = {};
  for (const h of hours.data ?? []) initial[h.weekday] ??= { opens: h.opens.slice(0, 5), closes: h.closes.slice(0, 5) };
  const lang = m.primaryLanguage;
  const save = saveService.bind(null, slug);

  return (
    <>
      <PageHeader title="Settings" detail="What your assistant tells callers. Changes apply from the next call." />
      <section aria-labelledby="hours-h" className="mb-10">
        <h2 id="hours-h" className="mb-1">Opening hours</h2>
        <p className="mb-3 text-ink-soft">Your regular week. Your assistant won’t offer bookings outside these times.</p>
        <HoursForm action={saveHours.bind(null, slug)} initial={initial} />
      </section>

      <section aria-labelledby="svc-h">
        <h2 id="svc-h" className="mb-1">Services and prices</h2>
        <p className="mb-3 max-w-[70ch] text-ink-soft">
          Your assistant only quotes a price once you’ve ticked “Quote this price”. Unapproved prices are never said on the phone.
        </p>
        <div className="sheet divide-y divide-rule">
          {(services.data ?? []).map((s: any) => (
            <form key={s.id} action={save} className="grid items-end gap-3 px-4 py-3 sm:grid-cols-[1fr_7rem_8rem_auto_auto_auto]">
              <input type="hidden" name="id" value={s.id} />
              <p className="font-medium sm:self-center">{s.names?.[lang] ?? s.names?.en}</p>
              <label className="field">
                <span>Minutes</span>
                <input className="input tnum" name="duration" type="number" min={5} max={600} defaultValue={s.duration_min} />
              </label>
              <label className="field">
                <span>Price (€)</span>
                <input className="input tnum" name="price" inputMode="decimal" defaultValue={s.price_minor == null ? '' : (s.price_minor / 100).toFixed(2)} />
              </label>
              <label className="flex items-center gap-2 pb-2">
                <input type="checkbox" name="approve" defaultChecked={s.price_approved} className="h-4 w-4 accent-action" />
                Quote this price
              </label>
              <label className="flex items-center gap-2 pb-2">
                <input type="checkbox" name="active" defaultChecked={s.active} className="h-4 w-4 accent-action" />
                Offered
              </label>
              <button className="btn btn-quiet">Save</button>
            </form>
          ))}
        </div>
      </section>
          <CalendarSection slug={slug} organizationId={m.organizationId} notice={calendar} />
    </>
  );
}
