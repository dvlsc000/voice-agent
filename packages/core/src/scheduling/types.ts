/** Wall-clock range in the business's local timezone, "HH:mm" 24h. End is exclusive. */
export interface LocalTimeRange {
  start: string;
  end: string;
}

/** ISO weekday (1 = Monday … 7 = Sunday) → open ranges. Missing/empty = closed. */
export type WeeklyHours = Partial<Record<1 | 2 | 3 | 4 | 5 | 6 | 7, LocalTimeRange[]>>;

/** Overrides the weekly pattern for one local calendar date (holidays, special hours). */
export interface DateException {
  date: string; // YYYY-MM-DD in business timezone
  closed: boolean;
  ranges?: LocalTimeRange[];
}

export interface StaffSchedule {
  staffId: string;
  weekly: WeeklyHours;
  exceptions?: DateException[];
}

/** Anything that blocks a staff member: confirmed appointments (incl. their buffers), live holds, external calendar events. */
export interface BusyInterval {
  staffId: string;
  start: string; // ISO-8601 instant
  end: string;
}

export interface ServiceSpec {
  id: string;
  durationMin: number;
  bufferBeforeMin?: number;
  bufferAfterMin?: number;
  /** Staff qualified to perform the service. Undefined = all staff. */
  staffIds?: string[];
}

export interface AvailabilityQuery {
  timezone: string; // IANA, e.g. Europe/Dublin, Europe/Zagreb
  from: string; // ISO instant (inclusive)
  to: string; // ISO instant (exclusive)
  now: string; // ISO instant — injected for determinism
  service: ServiceSpec;
  businessHours: WeeklyHours;
  businessExceptions?: DateException[];
  staff: StaffSchedule[];
  busy: BusyInterval[];
  slotIntervalMin?: number; // default 15
  minLeadMin?: number; // default 60
  maxDaysAhead?: number; // default 60
  staffId?: string; // restrict to a specific staff member
}

export interface Slot {
  staffId: string;
  start: string; // ISO UTC of appointment start
  end: string; // ISO UTC of appointment end (excl. buffers)
  blockStart: string; // incl. bufferBefore — what must be reserved
  blockEnd: string; // incl. bufferAfter
  localStart: string; // ISO with business offset, for display/speech
}
