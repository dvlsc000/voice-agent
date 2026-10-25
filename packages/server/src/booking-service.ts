import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import {
  CalendarConflictError,
  CalendarOutcomeUnknownError,
  CalendarUnavailableError,
  computeAvailableSlots,
  dayPartWindow,
  deriveBookingReference,
  hashReference,
  pickSpokenOptions,
  verifyReferenceAndPhone,
  type CalendarAdapter,
  type DayPart,
  type Slot,
} from '@vp/core';
import { isExclusionViolation, type Db, type Queryable } from './db';
import { loadBusy, loadSchedulingConfig, loadService, type OrgSchedulingConfig } from './scheduling-config';

export type BookingOutcome =
  | { status: 'confirmed'; appointmentId: string; reference: string; start: string; localStart: string; staffId: string }
  | { status: 'pending_check'; appointmentId: string }
  | { status: 'slot_unavailable' }
  | { status: 'calendar_unavailable' }
  | { status: 'invalid'; reason: string };

export interface CalendarBinding {
  adapter: CalendarAdapter;
  calendarId: string;
}

export interface BookingServiceDeps {
  db: Db;
  /** Returns the external calendar for a staff member, or null for the built-in calendar. */
  resolveCalendar?: (organizationId: string, staffId: string) => Promise<CalendarBinding | null>;
  now?: () => Date;
}

export class BookingService {
  private readonly now: () => Date;
  constructor(private readonly deps: BookingServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  private async slotIsAvailable(q: Queryable, cfg: OrgSchedulingConfig, serviceId: string, staffId: string, start: string, excludeId?: string): Promise<Slot | null> {
    const service = await loadService(q, cfg.organizationId, serviceId);
    if (!service) return null;
    const startDt = DateTime.fromISO(start, { zone: 'utc' });
    if (!startDt.isValid) return null;
    const end = startDt.plus({ minutes: service.durationMin });
    const busy = await loadBusy(q, cfg.organizationId, startDt.minus({ hours: 6 }).toISO()!, end.plus({ hours: 6 }).toISO()!, excludeId);
    const slots = computeAvailableSlots({
      timezone: cfg.timezone,
      from: startDt.toISO()!,
      to: end.toISO()!,
      now: this.now().toISOString(),
      service,
      businessHours: cfg.businessHours,
      businessExceptions: cfg.businessExceptions,
      staff: cfg.staff.filter((s) => s.bookable),
      busy,
      slotIntervalMin: cfg.rules.slotIntervalMin,
      minLeadMin: cfg.rules.minLeadMin,
      maxDaysAhead: cfg.rules.maxDaysAhead,
      staffId,
    });
    return slots.find((s) => s.start === startDt.toISO()) ?? null;
  }

  async checkAvailability(
    organizationId: string,
    input: { serviceId: string; staffId?: string; date: string; dayPart: DayPart; maxOptions?: number },
  ): Promise<{ ok: true; options: Slot[]; totalAvailable: number } | { ok: false; reason: 'unknown_service' | 'invalid_date' }> {
    const q = this.deps.db;
    const cfg = await loadSchedulingConfig(q, organizationId);
    const service = await loadService(q, organizationId, input.serviceId);
    if (!service) return { ok: false, reason: 'unknown_service' };
    let window: { from: string; to: string };
    try {
      window = dayPartWindow(input.date, input.dayPart, cfg.timezone);
    } catch {
      return { ok: false, reason: 'invalid_date' };
    }
    const busy = await loadBusy(q, organizationId, window.from, window.to);
    // External calendars: merge their busy times so we never offer what the business already filled elsewhere.
    if (this.deps.resolveCalendar) {
      for (const s of cfg.staff) {
        const cal = await this.deps.resolveCalendar(organizationId, s.staffId);
        if (!cal) continue;
        try {
          busy.push(...(await cal.adapter.listBusy({ staffCalendarIds: { [s.staffId]: cal.calendarId }, from: window.from, to: window.to })));
        } catch {
          // Calendar down: do not offer this staff member's times rather than risk a double booking.
          busy.push({ staffId: s.staffId, start: window.from, end: window.to });
        }
      }
    }
    const slots = computeAvailableSlots({
      timezone: cfg.timezone,
      ...window,
      now: this.now().toISOString(),
      service,
      businessHours: cfg.businessHours,
      businessExceptions: cfg.businessExceptions,
      staff: cfg.staff.filter((s) => s.bookable),
      busy,
      slotIntervalMin: cfg.rules.slotIntervalMin,
      minLeadMin: cfg.rules.minLeadMin,
      maxDaysAhead: cfg.rules.maxDaysAhead,
      staffId: input.staffId,
    });
    return { ok: true, options: pickSpokenOptions(slots, input.maxOptions ?? 3), totalAvailable: slots.length };
  }

  async book(
    organizationId: string,
    input: {
      serviceId: string;
      staffId: string;
      start: string;
      customerName: string;
      customerPhone: string;
      source: 'voice' | 'dashboard' | 'api';
      idempotencyKey: string;
      callId?: string;
    },
  ): Promise<BookingOutcome> {
    const db = this.deps.db;
    let prepared: { appointmentId: string; slot: Slot; cfg: OrgSchedulingConfig; reference: string } | BookingOutcome;
    try {
      prepared = await db.tx(async (q) => {
        const cfg = await loadSchedulingConfig(q, organizationId);
        if (cfg.status === 'suspended' || cfg.status === 'closed') return { status: 'invalid', reason: 'organization_inactive' } as const;

        // Idempotent replay (e.g. the voice platform retried the tool call).
        const existing = await q.query(
          `select id, status, starts_at, staff_id from public.appointments where organization_id = $1 and idempotency_key = $2`,
          [organizationId, input.idempotencyKey],
        );
        if (existing.rows[0]) {
          const e = existing.rows[0];
          if (e.status === 'confirmed') {
            const start = new Date(e.starts_at).toISOString();
            return {
              status: 'confirmed',
              appointmentId: e.id,
              reference: deriveBookingReference(cfg.referenceSalt, e.id),
              start,
              localStart: DateTime.fromISO(start).setZone(cfg.timezone).toISO()!,
              staffId: e.staff_id,
            } as const;
          }
          if (e.status === 'needs_reconciliation' || e.status === 'committing' || e.status === 'holding') return { status: 'pending_check', appointmentId: e.id } as const;
          return { status: 'slot_unavailable' } as const;
        }

        await q.query('select private.expire_stale_holds($1)', [organizationId]);
        const slot = await this.slotIsAvailable(q, cfg, input.serviceId, input.staffId, input.start);
        if (!slot) return { status: 'slot_unavailable' } as const;

        const customer = await q.query(
          `insert into public.customers (organization_id, full_name, phone_e164, last_contact_at)
           values ($1, $2, $3, now())
           on conflict (organization_id, phone_e164) where phone_e164 is not null
           do update set last_contact_at = now()
           returning id`,
          [organizationId, input.customerName, input.customerPhone],
        );
        const appointmentId = randomUUID();
        const reference = deriveBookingReference(cfg.referenceSalt, appointmentId);
        await q.query(
          `insert into public.appointments (id, organization_id, customer_id, service_id, staff_id, status, starts_at, ends_at,
                                            block_start, block_end, hold_expires_at, reference_hash, source, call_id, idempotency_key)
           values ($1, $2, $3, $4, $5, 'holding', $6, $7, $8, $9, now() + make_interval(secs => $10), $11, $12, $13, $14)`,
          [
            appointmentId, organizationId, customer.rows[0].id, input.serviceId, input.staffId, slot.start, slot.end,
            slot.blockStart, slot.blockEnd, cfg.rules.holdTtlSec, hashReference(reference, cfg.referenceSalt), input.source,
            input.callId ?? null, input.idempotencyKey,
          ],
        );
        await q.query(`update public.appointments set status = 'committing' where id = $1`, [appointmentId]);
        return { appointmentId, slot, cfg, reference };
      });
    } catch (e) {
      if (isExclusionViolation(e)) return { status: 'slot_unavailable' };
      throw e;
    }
    if ('status' in prepared) return prepared;

    const { appointmentId, slot, cfg, reference } = prepared;
    const calendar = this.deps.resolveCalendar ? await this.deps.resolveCalendar(organizationId, input.staffId) : null;
    if (calendar) {
      try {
        const ref = await calendar.adapter.createBooking({
          slot,
          calendarId: calendar.calendarId,
          title: 'Booking',
          description: `Booked by phone assistant. Ref ${appointmentId}`, // no customer PII in third-party calendar text by default
          idempotencyKey: input.idempotencyKey,
        });
        await db.query(`update public.appointments set status = 'confirmed', external_calendar_event_id = $2 where id = $1`, [appointmentId, ref.externalId]);
      } catch (e) {
        if (e instanceof CalendarOutcomeUnknownError) {
          await db.query(`update public.appointments set status = 'needs_reconciliation' where id = $1`, [appointmentId]);
          await this.enqueue(organizationId, 'reconcile_booking', { appointmentId }, `reconcile:${appointmentId}`);
          return { status: 'pending_check', appointmentId };
        }
        await db.query(`update public.appointments set status = 'failed' where id = $1`, [appointmentId]);
        if (e instanceof CalendarConflictError) return { status: 'slot_unavailable' };
        if (e instanceof CalendarUnavailableError) return { status: 'calendar_unavailable' };
        throw e;
      }
    } else {
      await db.query(`update public.appointments set status = 'confirmed' where id = $1`, [appointmentId]);
    }

    await this.enqueue(organizationId, 'send_booking_confirmation', { appointmentId }, `booking_confirmed:${appointmentId}`);
    return {
      status: 'confirmed',
      appointmentId,
      reference,
      start: slot.start,
      localStart: DateTime.fromISO(slot.start).setZone(cfg.timezone).toISO()!,
      staffId: slot.staffId,
    };
  }

  /** Finds the caller's upcoming booking(s) and checks reference + phone. A name is never enough. */
  async verifyCaller(
    organizationId: string,
    input: { reference: string; callerIdE164: string | null; statedPhoneE164?: string | null; attemptsSoFar: number },
  ): Promise<{ ok: true; appointmentIds: string[] } | { ok: false; reason: string }> {
    const cfg = await loadSchedulingConfig(this.deps.db, organizationId);
    const hash = hashReference(input.reference, cfg.referenceSalt);
    const { rows } = await this.deps.db.query(
      `select a.id, a.reference_hash, c.phone_e164 from public.appointments a
         left join public.customers c on c.id = a.customer_id
        where a.organization_id = $1 and a.reference_hash = $2 and a.status = 'confirmed' and a.starts_at > now()`,
      [organizationId, hash],
    );
    const matched: string[] = [];
    for (const r of rows) {
      const v = verifyReferenceAndPhone(
        { statedReference: input.reference, callerIdE164: input.callerIdE164, statedPhoneE164: input.statedPhoneE164 ?? null, attemptsSoFar: input.attemptsSoFar },
        { referenceHash: r.reference_hash, customerPhoneE164: r.phone_e164 },
        cfg.referenceSalt,
      );
      if (v.ok) matched.push(r.id);
    }
    if (input.attemptsSoFar >= 3) return { ok: false, reason: 'too_many_attempts' };
    return matched.length > 0 ? { ok: true, appointmentIds: matched } : { ok: false, reason: 'mismatch' };
  }

  async cancel(
    organizationId: string,
    appointmentId: string,
    opts: { reason: string; enforceNotice: boolean },
  ): Promise<{ status: 'cancelled' } | { status: 'not_found' | 'too_late' | 'calendar_unavailable' }> {
    const cfg = await loadSchedulingConfig(this.deps.db, organizationId);
    const { rows } = await this.deps.db.query(
      `select id, staff_id, starts_at, status, external_calendar_event_id from public.appointments where organization_id = $1 and id = $2`,
      [organizationId, appointmentId],
    );
    const a = rows[0];
    if (!a || a.status !== 'confirmed') return { status: 'not_found' };
    const hoursUntil = (new Date(a.starts_at).getTime() - this.now().getTime()) / 3_600_000;
    if (opts.enforceNotice && hoursUntil < cfg.rules.cancellationNoticeHours) return { status: 'too_late' };

    const calendar = this.deps.resolveCalendar ? await this.deps.resolveCalendar(organizationId, a.staff_id) : null;
    if (calendar && a.external_calendar_event_id) {
      try {
        await calendar.adapter.cancelBooking({ ref: { externalId: a.external_calendar_event_id }, calendarId: calendar.calendarId });
      } catch {
        return { status: 'calendar_unavailable' };
      }
    }
    await this.deps.db.query(`update public.appointments set status = 'cancelled', cancellation_reason = $3 where organization_id = $1 and id = $2`, [
      organizationId,
      appointmentId,
      opts.reason,
    ]);
    await this.enqueue(organizationId, 'send_cancellation_notice', { appointmentId }, `booking_cancelled:${appointmentId}`);
    return { status: 'cancelled' };
  }

  /**
   * Built-in calendar: atomic — the old booking is released and the new one taken in one transaction,
   * so a failure leaves the original appointment untouched. (External calendars: book-new-then-cancel-old,
   * see docs/booking-engine.md.)
   */
  async reschedule(
    organizationId: string,
    appointmentId: string,
    input: { newStart: string; staffId: string; idempotencyKey: string },
  ): Promise<BookingOutcome> {
    const db = this.deps.db;
    try {
      return await db.tx(async (q) => {
        const cfg = await loadSchedulingConfig(q, organizationId);
        const old = await q.query(
          `select id, customer_id, service_id, status, call_id from public.appointments where organization_id = $1 and id = $2 for update`,
          [organizationId, appointmentId],
        );
        const o = old.rows[0];
        if (!o || o.status !== 'confirmed') return { status: 'invalid', reason: 'not_found' } as const;
        const slot = await this.slotIsAvailable(q, cfg, o.service_id, input.staffId, input.newStart, appointmentId);
        if (!slot) return { status: 'slot_unavailable' } as const;
        await q.query(`update public.appointments set status = 'cancelled', cancellation_reason = 'rescheduled' where id = $1`, [appointmentId]);
        const newId = randomUUID();
        const reference = deriveBookingReference(cfg.referenceSalt, newId);
        await q.query(
          `insert into public.appointments (id, organization_id, customer_id, service_id, staff_id, status, starts_at, ends_at, block_start, block_end,
                                            hold_expires_at, reference_hash, source, idempotency_key, rescheduled_from_id)
           values ($1, $2, $3, $4, $5, 'holding', $6, $7, $8, $9, now() + interval '5 minutes', $10, 'voice', $11, $12)`,
          [newId, organizationId, o.customer_id, o.service_id, input.staffId, slot.start, slot.end, slot.blockStart, slot.blockEnd,
            hashReference(reference, cfg.referenceSalt), input.idempotencyKey, appointmentId],
        );
        await q.query(`update public.appointments set status = 'committing' where id = $1`, [newId]);
        await q.query(`update public.appointments set status = 'confirmed' where id = $1`, [newId]);
        await this.enqueue(organizationId, 'send_booking_confirmation', { appointmentId: newId, rescheduledFrom: appointmentId }, `booking_confirmed:${newId}`, q);
        return {
          status: 'confirmed',
          appointmentId: newId,
          reference,
          start: slot.start,
          localStart: DateTime.fromISO(slot.start).setZone(cfg.timezone).toISO()!,
          staffId: slot.staffId,
        } as const;
      });
    } catch (e) {
      if (isExclusionViolation(e)) return { status: 'slot_unavailable' };
      throw e;
    }
  }

  private async enqueue(organizationId: string, kind: string, payload: object, dedupeKey: string, q: Queryable = this.deps.db): Promise<void> {
    await q.query(
      `insert into public.jobs (queue, kind, organization_id, payload, dedupe_key) values ('default', $1, $2, $3, $4)
       on conflict (dedupe_key) do nothing`,
      [kind, organizationId, JSON.stringify(payload), dedupeKey],
    );
  }
}
