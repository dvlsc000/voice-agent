import { DateTime, Interval } from 'luxon';
import type {
  AvailabilityQuery,
  DateException,
  LocalTimeRange,
  Slot,
  StaffSchedule,
  WeeklyHours,
} from './types.js';

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$|^24:00$/;

function parseHHMM(v: string): { hour: number; minute: number } {
  if (!HHMM.test(v)) throw new Error(`Invalid time "${v}", expected HH:mm`);
  const [h, m] = v.split(':').map(Number) as [number, number];
  return { hour: h, minute: m };
}

/** Resolve a local wall-clock time on a local date to an absolute instant, DST-aware. */
export function localToInstant(dateISO: string, hhmm: string, zone: string): DateTime {
  const { hour, minute } = parseHHMM(hhmm);
  const day = DateTime.fromISO(dateISO, { zone });
  if (!day.isValid) throw new Error(`Invalid date ${dateISO} in zone ${zone}`);
  if (hour === 24) return day.plus({ days: 1 }).startOf('day');
  // Luxon resolves non-existent (spring-forward gap) times by shifting forward,
  // and ambiguous (fall-back) times to the earlier offset. Both are acceptable for opening hours,
  // which in IE/HR never sit inside the 01:00–03:00 transition window; tests pin this behaviour.
  return day.set({ hour, minute, second: 0, millisecond: 0 });
}

function rangesForDate(
  dateISO: string,
  weekly: WeeklyHours,
  exceptions: DateException[] | undefined,
  zone: string,
): Interval[] {
  const exception = exceptions?.find((e) => e.date === dateISO);
  let ranges: LocalTimeRange[];
  if (exception) {
    ranges = exception.closed ? [] : (exception.ranges ?? []);
  } else {
    const weekday = DateTime.fromISO(dateISO, { zone }).weekday as 1 | 2 | 3 | 4 | 5 | 6 | 7;
    ranges = weekly[weekday] ?? [];
  }
  return ranges
    .map((r) => Interval.fromDateTimes(localToInstant(dateISO, r.start, zone), localToInstant(dateISO, r.end, zone)))
    .filter((i) => i.isValid && !i.isEmpty());
}

function intersectAll(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const x of a) {
    for (const y of b) {
      const i = x.intersection(y);
      if (i && !i.isEmpty()) out.push(i);
    }
  }
  return out;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Compute bookable slots. Pure and deterministic: all inputs, including "now", are explicit.
 *
 * Rules:
 *  - The appointment itself must lie entirely within the intersection of business and staff hours.
 *  - The blocked window (appointment + buffers) must not overlap any busy interval for that staff member.
 *    Busy intervals for existing appointments must already include their own buffers.
 *  - Start must be >= now + minLead and within maxDaysAhead.
 *  - Candidate starts are aligned to slotInterval from each open range's start.
 */
export function computeAvailableSlots(q: AvailabilityQuery): Slot[] {
  const zone = q.timezone;
  if (!DateTime.local().setZone(zone).isValid) throw new Error(`Unknown timezone ${zone}`);
  const step = q.slotIntervalMin ?? 15;
  const lead = q.minLeadMin ?? 60;
  const maxDays = q.maxDaysAhead ?? 60;
  const { service } = q;
  if (service.durationMin <= 0) throw new Error('Service duration must be positive');
  const before = service.bufferBeforeMin ?? 0;
  const after = service.bufferAfterMin ?? 0;

  const now = DateTime.fromISO(q.now, { zone: 'utc' });
  const earliest = DateTime.max(DateTime.fromISO(q.from, { zone: 'utc' }), now.plus({ minutes: lead }));
  const latest = DateTime.min(DateTime.fromISO(q.to, { zone: 'utc' }), now.plus({ days: maxDays }));
  if (earliest >= latest) return [];

  const eligibleStaff: StaffSchedule[] = q.staff.filter(
    (s) =>
      (!service.staffIds || service.staffIds.includes(s.staffId)) &&
      (!q.staffId || s.staffId === q.staffId),
  );

  const busyByStaff = new Map<string, Array<[number, number]>>();
  for (const b of q.busy) {
    const list = busyByStaff.get(b.staffId) ?? [];
    list.push([Date.parse(b.start), Date.parse(b.end)]);
    busyByStaff.set(b.staffId, list);
  }

  const slots: Slot[] = [];
  let day = earliest.setZone(zone).startOf('day');
  const lastDay = latest.setZone(zone).startOf('day');
  while (day <= lastDay) {
    const dateISO = day.toISODate()!;
    const business = rangesForDate(dateISO, q.businessHours, q.businessExceptions, zone);
    if (business.length > 0) {
      for (const staff of eligibleStaff) {
        const open = intersectAll(business, rangesForDate(dateISO, staff.weekly, staff.exceptions, zone));
        const busy = busyByStaff.get(staff.staffId) ?? [];
        for (const range of open) {
          let start = range.start!;
          while (true) {
            const end = start.plus({ minutes: service.durationMin });
            if (end > range.end!) break;
            if (start >= earliest && end <= latest) {
              const blockStart = start.minus({ minutes: before });
              const blockEnd = end.plus({ minutes: after });
              const bs = blockStart.toMillis();
              const be = blockEnd.toMillis();
              if (!busy.some(([s, e]) => overlaps(bs, be, s, e))) {
                slots.push({
                  staffId: staff.staffId,
                  start: start.toUTC().toISO()!,
                  end: end.toUTC().toISO()!,
                  blockStart: blockStart.toUTC().toISO()!,
                  blockEnd: blockEnd.toUTC().toISO()!,
                  localStart: start.setZone(zone).toISO({ suppressMilliseconds: true })!,
                });
              }
            }
            start = start.plus({ minutes: step });
          }
        }
      }
    }
    day = day.plus({ days: 1 });
  }
  slots.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.staffId.localeCompare(b.staffId)));
  return slots;
}

/**
 * Choose a small, well-spread set of options to read out on a call (voice UX: 2–3 options, not 40).
 * Collapses identical start times across staff and prefers spacing of at least `minGapMin`.
 */
export function pickSpokenOptions(slots: Slot[], count = 3, minGapMin = 60): Slot[] {
  const picked: Slot[] = [];
  const seenStarts = new Set<string>();
  for (const s of slots) {
    if (seenStarts.has(s.start)) continue;
    const t = Date.parse(s.start);
    if (picked.every((p) => Math.abs(Date.parse(p.start) - t) >= minGapMin * 60_000)) {
      picked.push(s);
      seenStarts.add(s.start);
    }
    if (picked.length === count) return picked;
  }
  // Not enough spread-out options: fill with the next earliest distinct starts.
  for (const s of slots) {
    if (picked.length === count) break;
    if (!seenStarts.has(s.start)) {
      picked.push(s);
      seenStarts.add(s.start);
    }
  }
  return picked.sort((a, b) => a.start.localeCompare(b.start));
}
