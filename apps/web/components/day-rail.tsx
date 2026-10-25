import { DateTime } from 'luxon';

export interface RailBooking {
  id: string;
  start: string;
  end: string;
  label: string;
  confirmed: boolean;
}
export interface RailCall {
  id: string;
  at: string;
  needsAttention: boolean;
}

/**
 * Today on one line: opening hours as the rail, bookings as blocks, calls as ticks above it,
 * and "now" as a marker. The lists below it carry the same information for screen readers.
 */
export function DayRail({
  timezone,
  opens,
  closes,
  bookings,
  calls,
  now,
}: {
  timezone: string;
  opens: string | null;
  closes: string | null;
  bookings: RailBooking[];
  calls: RailCall[];
  now: string;
}) {
  const today = DateTime.fromISO(now).setZone(timezone);
  const startH = opens ? Number(opens.slice(0, 2)) : 8;
  const endH = closes ? Math.min(24, Math.ceil(Number(closes.slice(0, 2)) + Number(closes.slice(3, 5)) / 60)) : 19;
  const railStart = today.set({ hour: Math.max(0, startH - 1), minute: 0, second: 0, millisecond: 0 });
  const railEnd = today.set({ hour: Math.min(23, endH), minute: 59, second: 0, millisecond: 0 });
  const span = railEnd.toMillis() - railStart.toMillis();
  const pos = (iso: string) => Math.min(100, Math.max(0, ((DateTime.fromISO(iso).toMillis() - railStart.toMillis()) / span) * 100));
  const hours: number[] = [];
  for (let h = railStart.hour; h <= railEnd.hour; h++) hours.push(h);
  const openL = opens ? pos(today.set({ hour: startH, minute: Number(opens.slice(3, 5)) }).toISO()!) : null;
  const openR = closes ? pos(today.set({ hour: Number(closes.slice(0, 2)), minute: Number(closes.slice(3, 5)) }).toISO()!) : null;

  return (
    <figure aria-label={`Today: ${bookings.length} bookings and ${calls.length} calls`} className="select-none">
      <div aria-hidden className="relative h-[92px]">
        {/* calls */}
        <div className="absolute inset-x-0 top-0 h-6">
          {calls.map((c) => (
            <span
              key={c.id}
              className={`absolute top-1 h-4 w-[3px] -translate-x-1/2 rounded-full ${c.needsAttention ? 'bg-lamp-amber' : 'bg-ink-faint'}`}
              style={{ left: `${pos(c.at)}%` }}
            />
          ))}
        </div>
        {/* rail */}
        <div className="absolute inset-x-0 top-[34px] h-[2px] bg-rule" />
        {openL !== null && openR !== null ? (
          <div className="absolute top-[33px] h-[4px] rounded-full bg-ink" style={{ left: `${openL}%`, width: `${openR - openL}%` }} />
        ) : null}
        {/* bookings */}
        <div className="absolute inset-x-0 top-[44px] h-7">
          {bookings.map((b) => (
            <span
              key={b.id}
              title={b.label}
              className={`absolute h-7 overflow-hidden rounded-[4px] border px-1 text-[0.7rem] leading-7 whitespace-nowrap ${b.confirmed ? 'border-lamp-green bg-lamp-green-wash text-ink' : 'border-lamp-amber bg-lamp-amber-wash text-ink'}`}
              style={{ left: `${pos(b.start)}%`, width: `${Math.max(1.2, pos(b.end) - pos(b.start))}%` }}
            >
              {b.label}
            </span>
          ))}
        </div>
        {/* now */}
        {today >= railStart && today <= railEnd ? (
          <span className="absolute top-0 bottom-3 w-[2px] bg-action" style={{ left: `${pos(now)}%` }} />
        ) : null}
        {/* hour labels */}
        <div className="absolute inset-x-0 bottom-0 h-4">
          {hours.map((h) => (
            <span key={h} className="tnum absolute -translate-x-1/2 text-[0.7rem] text-ink-faint" style={{ left: `${pos(today.set({ hour: h, minute: 0 }).toISO()!)}%` }}>
              {h % 2 === 0 ? `${h}:00` : ''}
            </span>
          ))}
        </div>
      </div>
      <figcaption className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[0.8rem] text-ink-soft">
        <span><span aria-hidden className="mr-1.5 inline-block h-3 w-[3px] rounded-full bg-ink-faint align-middle" />Call answered</span>
        <span><span aria-hidden className="mr-1.5 inline-block h-3 w-[3px] rounded-full bg-lamp-amber align-middle" />Call that needs you</span>
        <span><span aria-hidden className="mr-1.5 inline-block h-2 w-4 rounded-sm border border-lamp-green bg-lamp-green-wash align-middle" />Booking</span>
      </figcaption>
    </figure>
  );
}
