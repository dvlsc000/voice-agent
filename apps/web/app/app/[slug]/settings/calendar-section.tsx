import { Lamp } from '@/components/lamp';
import { supabaseServer } from '@/lib/supabase/server';
import { googleOAuthConfig } from '@/lib/env';
import { assignStaffCalendar, disconnect } from './calendar-actions';

const NOTICE: Record<string, { tone: 'green' | 'amber' | 'red'; text: string }> = {
  connected: { tone: 'green', text: 'Google Calendar connected. Choose which calendar each person uses below.' },
  cancelled: { tone: 'amber', text: 'Connection cancelled. Nothing was changed.' },
  failed: { tone: 'red', text: 'We couldn’t connect your calendar. Try again, and make sure you allow both permissions Google asks for.' },
  unavailable: { tone: 'amber', text: 'Calendar connections aren’t set up on this system yet. Contact support.' },
};

export async function CalendarSection({ slug, organizationId, notice }: { slug: string; organizationId: string; notice?: string }) {
  const sb = await supabaseServer();
  const [conns, staff] = await Promise.all([
    sb.from('integration_connections').select('id, provider, status, account_label, last_error').eq('organization_id', organizationId).neq('status', 'revoked'),
    sb.from('staff_members').select('id, display_name, calendar_connection_id, external_calendar_id').eq('organization_id', organizationId).eq('active', true).order('display_name'),
  ]);
  const connections = conns.data ?? [];
  const n = notice ? NOTICE[notice] : undefined;
  const assign = assignStaffCalendar.bind(null, slug);
  const disc = disconnect.bind(null, slug);
  return (
    <section aria-labelledby="cal-h" className="mt-10">
      <h2 id="cal-h" className="mb-1">Calendar</h2>
      <p className="mb-3 max-w-[70ch] text-ink-soft">
        Connect the calendar you already use and your assistant will book straight into it, and never offer a time that’s already taken there.
        Without a connection, bookings go into the diary on this site.
      </p>
      {n ? <p role="status" className={`mb-3 rounded-md px-4 py-2 ${n.tone === 'green' ? 'bg-lamp-green-wash' : n.tone === 'amber' ? 'bg-lamp-amber-wash text-lamp-amber-ink' : 'bg-lamp-red-wash'}`}>{n.text}</p> : null}
      <div className="sheet divide-y divide-rule">
        {connections.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="font-medium">Google Calendar{c.account_label ? `: ${c.account_label}` : ''}</p>
              {c.last_error ? <p className="text-[0.9rem] text-lamp-red">{c.last_error}</p> : null}
            </div>
            <div className="flex items-center gap-3">
              <Lamp tone={c.status === 'connected' ? 'green' : 'red'}>{c.status === 'connected' ? 'Connected' : 'Needs reconnecting'}</Lamp>
              <form action={disc}>
                <input type="hidden" name="connectionId" value={c.id} />
                <button className="btn btn-quiet">Disconnect</button>
              </form>
            </div>
          </div>
        ))}
        <div className="px-4 py-3">
          {googleOAuthConfig() ? (
            <a className="btn btn-quiet" href={`/api/integrations/google/start?org=${encodeURIComponent(slug)}`}>{connections.length ? 'Connect another Google account' : 'Connect Google Calendar'}</a>
          ) : (
            <p className="text-ink-faint">Calendar connections aren’t available yet on this system.</p>
          )}
        </div>
      </div>

      {connections.length ? (
        <div className="sheet mt-4 divide-y divide-rule">
          {(staff.data ?? []).map((s) => (
            <form key={s.id} action={assign} className="grid items-end gap-3 px-4 py-3 sm:grid-cols-[1fr_14rem_14rem_auto]">
              <input type="hidden" name="staffId" value={s.id} />
              <p className="font-medium sm:self-center">{s.display_name}</p>
              <label className="field">
                <span>Account</span>
                <select className="input" name="connectionId" defaultValue={s.calendar_connection_id ?? ''}>
                  <option value="">Diary on this site</option>
                  {connections.map((c) => <option key={c.id} value={c.id}>{c.account_label ?? 'Google account'}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Calendar ID</span>
                <input className="input" name="calendarId" defaultValue={s.external_calendar_id ?? 'primary'} placeholder="primary" />
              </label>
              <button className="btn btn-quiet">Save</button>
            </form>
          ))}
          <p className="px-4 py-3 text-[0.85rem] text-ink-faint">“primary” means the main calendar of that Google account. For a shared or staff calendar, paste its calendar ID from Google Calendar settings.</p>
        </div>
      ) : null}
    </section>
  );
}
