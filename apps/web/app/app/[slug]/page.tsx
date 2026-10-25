import Link from 'next/link';
import { DateTime } from 'luxon';
import { DayRail } from '@/components/day-rail';
import { BOOKING_LABEL, Lamp, OUTCOME_LABEL, bookingTone } from '@/components/lamp';
import { Empty, PageHeader } from '@/components/page-header';
import { requireMembership } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';

export const metadata = { title: 'Today' };

const ATTENTION = new Set(['escalated', 'message_taken', 'lead_captured', 'failed']);

export default async function TodayPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireMembership(slug);
  const sb = await supabaseServer();
  const now = DateTime.now().setZone(m.timezone);
  const dayStart = now.startOf('day').toUTC().toISO()!;
  const dayEnd = now.endOf('day').toUTC().toISO()!;

  const [appts, calls, enquiries, hours] = await Promise.all([
    sb
      .from('appointments')
      .select('id, starts_at, ends_at, status, staff_members(display_name), services(names), customers(full_name)')
      .eq('organization_id', m.organizationId)
      .gte('starts_at', dayStart)
      .lte('starts_at', dayEnd)
      .in('status', ['confirmed', 'needs_reconciliation', 'completed', 'no_show'])
      .order('starts_at'),
    sb.from('calls').select('id, started_at, outcome, duration_sec').eq('organization_id', m.organizationId).gte('started_at', dayStart).order('started_at'),
    sb.from('enquiries').select('id, kind, urgency, caller_name, summary, created_at').eq('organization_id', m.organizationId).eq('status', 'new').order('created_at', { ascending: false }).limit(5),
    sb.from('business_hours').select('opens, closes').eq('organization_id', m.organizationId).eq('weekday', now.weekday).order('opens'),
  ]);
  const err = appts.error ?? calls.error ?? enquiries.error ?? hours.error;
  if (err) throw new Error(err.message);

  const lang = m.primaryLanguage;
  const time = (iso: string) => DateTime.fromISO(iso).setZone(m.timezone).toFormat('H:mm');
  const bookings = (appts.data ?? []) as any[];
  const callRows = (calls.data ?? []) as any[];
  const opens = hours.data?.[0]?.opens ?? null;
  const closes = hours.data?.at(-1)?.closes ?? null;
  const booked = callRows.filter((c) => c.outcome === 'booked').length;

  return (
    <>
      <PageHeader
        title={now.setLocale(lang === 'hr' ? 'hr' : 'en-IE').toFormat('cccc d MMMM')}
        detail={
          callRows.length === 0
            ? 'No calls yet today.'
            : `${callRows.length} ${callRows.length === 1 ? 'call' : 'calls'} answered, ${booked} booked by phone.`
        }
      />

      <section className="sheet px-5 pt-5 pb-4" aria-labelledby="rail-h">
        <h2 id="rail-h" className="sr-only">Today at a glance</h2>
        {opens === null ? (
          <p className="pb-2 text-ink-soft">You’re closed today.</p>
        ) : (
          <DayRail
            timezone={m.timezone}
            opens={opens}
            closes={closes}
            now={now.toISO()!}
            bookings={bookings.map((b) => ({
              id: b.id,
              start: b.starts_at,
              end: b.ends_at,
              confirmed: b.status === 'confirmed' || b.status === 'completed',
              label: b.services?.names?.[lang] ?? b.services?.names?.en ?? 'Booking',
            }))}
            calls={callRows.map((c) => ({ id: c.id, at: c.started_at, needsAttention: ATTENTION.has(c.outcome) }))}
          />
        )}
      </section>

      <div className="mt-8 grid gap-8 lg:grid-cols-[3fr_2fr]">
        <section aria-labelledby="bookings-h">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 id="bookings-h">Bookings today</h2>
            <Link href={`/app/${slug}/bookings`} className="text-[0.9rem] text-action-ink hover:underline">All bookings</Link>
          </div>
          <div className="sheet">
            {bookings.length === 0 ? (
              <Empty title="Nothing booked for today." />
            ) : (
              <table className="table">
                <thead>
                  <tr><th>Time</th><th>Who</th><th>What</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {bookings.map((b) => (
                    <tr key={b.id}>
                      <td className="tnum font-medium">{time(b.starts_at)}</td>
                      <td>
                        {b.customers?.full_name ?? '—'}
                        <div className="text-[0.85rem] text-ink-faint">with {b.staff_members?.display_name}</div>
                      </td>
                      <td>{b.services?.names?.[lang] ?? b.services?.names?.en}</td>
                      <td><Lamp tone={bookingTone(b.status)}>{BOOKING_LABEL[b.status] ?? b.status}</Lamp></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section aria-labelledby="msg-h">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 id="msg-h">Waiting for you</h2>
            <Link href={`/app/${slug}/messages`} className="text-[0.9rem] text-action-ink hover:underline">All messages</Link>
          </div>
          <div className="sheet">
            {(enquiries.data ?? []).length === 0 ? (
              <Empty title="You’re all caught up." />
            ) : (
              <ul className="divide-y divide-rule">
                {(enquiries.data ?? []).map((e: any) => (
                  <li key={e.id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{e.caller_name ?? 'Unknown caller'}</span>
                      {e.urgency === 'urgent' ? <Lamp tone="amber">Urgent</Lamp> : <span className="tnum text-[0.85rem] text-ink-faint">{time(e.created_at)}</span>}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-ink-soft">{e.summary}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <h2 className="mt-8 mb-2">Calls today</h2>
          <div className="sheet">
            {callRows.length === 0 ? (
              <Empty title="No calls yet." />
            ) : (
              <ul className="divide-y divide-rule">
                {callRows.slice(-6).reverse().map((c) => (
                  <li key={c.id}>
                    <Link href={`/app/${slug}/calls/${c.id}`} className="flex items-center justify-between px-4 py-2.5 hover:bg-ground">
                      <span className="tnum text-ink-soft">{time(c.started_at)}</span>
                      <span>{OUTCOME_LABEL[c.outcome] ?? 'In progress'}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
