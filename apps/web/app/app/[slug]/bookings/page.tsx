import { DateTime } from 'luxon';
import { BOOKING_LABEL, Lamp, bookingTone } from '@/components/lamp';
import { Empty, PageHeader } from '@/components/page-header';
import { requireMembership } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';

export const metadata = { title: 'Bookings' };

export default async function BookingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireMembership(slug);
  const sb = await supabaseServer();
  const { data, error } = await sb
    .from('appointments')
    .select('id, starts_at, status, source, staff_members(display_name), services(names), customers(full_name, phone_e164)')
    .eq('organization_id', m.organizationId)
    .gte('starts_at', DateTime.now().startOf('day').toUTC().toISO()!)
    .in('status', ['confirmed', 'needs_reconciliation', 'cancelled'])
    .order('starts_at')
    .limit(200);
  if (error) throw new Error(error.message);
  const lang = m.primaryLanguage;
  let lastDay = '';
  return (
    <>
      <PageHeader title="Upcoming bookings" detail="Bookings made by your assistant, by staff, and synced from your calendar." />
      <div className="sheet overflow-x-auto">
        {!data?.length ? (
          <Empty title="No upcoming bookings." />
        ) : (
          <table className="table min-w-[600px]">
            <thead>
              <tr><th>Time</th><th>Customer</th><th>Service</th><th>Status</th></tr>
            </thead>
            <tbody>
              {data.map((b: any) => {
                const t = DateTime.fromISO(b.starts_at).setZone(m.timezone);
                const day = t.toFormat('cccc d LLLL');
                const header = day !== lastDay;
                lastDay = day;
                return [
                  header ? (
                    <tr key={`${b.id}-d`}>
                      <td colSpan={4} className="bg-ground py-1.5 text-[0.85rem] font-semibold text-ink-soft">{day}</td>
                    </tr>
                  ) : null,
                  <tr key={b.id}>
                    <td className="tnum font-medium">{t.toFormat('H:mm')}</td>
                    <td>
                      {b.customers?.full_name ?? '—'}
                      {b.customers?.phone_e164 ? <div className="tnum text-[0.85rem] text-ink-faint">{b.customers.phone_e164}</div> : null}
                    </td>
                    <td>
                      {b.services?.names?.[lang] ?? b.services?.names?.en}
                      <div className="text-[0.85rem] text-ink-faint">with {b.staff_members?.display_name}{b.source === 'voice' ? ', booked by phone' : ''}</div>
                    </td>
                    <td><Lamp tone={bookingTone(b.status)}>{BOOKING_LABEL[b.status] ?? b.status}</Lamp></td>
                  </tr>,
                ];
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
