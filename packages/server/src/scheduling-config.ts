import type { BusyInterval, DateException, ServiceSpec, StaffSchedule, WeeklyHours } from '@vp/core';
import type { Queryable } from './db';

export interface OrgSchedulingConfig {
  organizationId: string;
  timezone: string;
  country: 'IE' | 'HR';
  referenceSalt: string;
  status: 'onboarding' | 'trial' | 'active' | 'suspended' | 'closed';
  rules: { slotIntervalMin: number; minLeadMin: number; maxDaysAhead: number; holdTtlSec: number; cancellationNoticeHours: number };
  businessHours: WeeklyHours;
  businessExceptions: DateException[];
  staff: Array<StaffSchedule & { displayName: string; aliases: string[]; bookable: boolean }>;
}

const hhmm = (t: string): string => t.slice(0, 5);

function toWeekly(rows: Array<{ weekday: number; start: string; end: string }>): WeeklyHours {
  const w: WeeklyHours = {};
  for (const r of rows) {
    const d = r.weekday as 1 | 2 | 3 | 4 | 5 | 6 | 7;
    (w[d] ??= []).push({ start: hhmm(r.start), end: r.end === '00:00:00' ? '24:00' : hhmm(r.end) });
  }
  return w;
}

/** Loads everything availability needs for one organization (primary location for now). */
export async function loadSchedulingConfig(q: Queryable, organizationId: string): Promise<OrgSchedulingConfig> {
  const org = await q.query(
    `select o.id, o.timezone, o.country, o.reference_salt, o.status,
            coalesce(r.slot_interval_min, 15) as slot_interval_min, coalesce(r.min_lead_min, 60) as min_lead_min,
            coalesce(r.max_days_ahead, 60) as max_days_ahead, coalesce(r.hold_ttl_sec, 300) as hold_ttl_sec,
            coalesce(r.cancellation_notice_hours, 24) as cancellation_notice_hours
       from public.organizations o left join public.booking_rules r on r.organization_id = o.id
      where o.id = $1`,
    [organizationId],
  );
  const o = org.rows[0];
  if (!o) throw new Error('Organization not found');

  const hours = await q.query(
    `select h.weekday, h.opens::text as start, h.closes::text as "end"
       from public.business_hours h join public.locations l on l.id = h.location_id
      where h.organization_id = $1 and l.is_primary order by h.weekday, h.opens`,
    [organizationId],
  );
  const exceptions = await q.query(
    `select staff_id, date::text as date, closed, ranges from public.date_exceptions where organization_id = $1 and date >= current_date - 1`,
    [organizationId],
  );
  const staff = await q.query(
    `select s.id, s.display_name, s.aliases, s.bookable from public.staff_members s
      where s.organization_id = $1 and s.active order by s.display_name`,
    [organizationId],
  );
  const staffHours = await q.query(
    `select staff_id, weekday, starts::text as start, ends::text as "end" from public.staff_hours where organization_id = $1 order by weekday, starts`,
    [organizationId],
  );

  const toException = (r: { date: string; closed: boolean; ranges: Array<{ start: string; end: string }> }): DateException => ({
    date: r.date,
    closed: r.closed,
    ranges: r.ranges,
  });

  return {
    organizationId,
    timezone: o.timezone,
    country: o.country,
    referenceSalt: o.reference_salt,
    status: o.status,
    rules: {
      slotIntervalMin: o.slot_interval_min,
      minLeadMin: o.min_lead_min,
      maxDaysAhead: o.max_days_ahead,
      holdTtlSec: o.hold_ttl_sec,
      cancellationNoticeHours: o.cancellation_notice_hours,
    },
    businessHours: toWeekly(hours.rows),
    businessExceptions: exceptions.rows.filter((r) => !r.staff_id).map(toException),
    staff: staff.rows.map((s) => ({
      staffId: s.id,
      displayName: s.display_name,
      aliases: s.aliases,
      bookable: s.bookable,
      weekly: toWeekly(staffHours.rows.filter((h) => h.staff_id === s.id)),
      exceptions: exceptions.rows.filter((r) => r.staff_id === s.id).map(toException),
    })),
  };
}

export async function loadService(q: Queryable, organizationId: string, serviceId: string): Promise<(ServiceSpec & { names: Record<string, string> }) | null> {
  const { rows } = await q.query(
    `select s.id, s.names, s.duration_min, s.buffer_before_min, s.buffer_after_min,
            array_remove(array_agg(ss.staff_id), null) as staff_ids
       from public.services s left join public.service_staff ss on ss.service_id = s.id
      where s.organization_id = $1 and s.id = $2 and s.active and s.bookable_by_phone
      group by s.id`,
    [organizationId, serviceId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    names: r.names,
    durationMin: r.duration_min,
    bufferBeforeMin: r.buffer_before_min,
    bufferAfterMin: r.buffer_after_min,
    staffIds: r.staff_ids.length > 0 ? r.staff_ids : undefined,
  };
}

/** Live bookings that block time (unexpired holds plus committing/confirmed/reconciling). */
export async function loadBusy(
  q: Queryable,
  organizationId: string,
  from: string,
  to: string,
  excludeAppointmentId?: string,
): Promise<BusyInterval[]> {
  const { rows } = await q.query(
    `select staff_id, block_start, block_end from public.appointments
      where organization_id = $1 and block_end > $2 and block_start < $3
        and (status in ('committing', 'confirmed', 'needs_reconciliation') or (status = 'holding' and hold_expires_at > now()))
        and ($4::uuid is null or id <> $4)`,
    [organizationId, from, to, excludeAppointmentId ?? null],
  );
  return rows.map((r) => ({
    staffId: r.staff_id,
    start: new Date(r.block_start).toISOString(),
    end: new Date(r.block_end).toISOString(),
  }));
}
