import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import {
  CalendarOutcomeUnknownError,
  CalendarUnavailableError,
  toolsForCapabilities,
  type CalendarAdapter,
  type Capability,
} from '@vp/core';
import { BookingService, Db, ToolExecutor, renderBusinessFacts, type CallSession } from '../src/index';

/**
 * End-to-end booking flow against a real PostgreSQL with the production schema (no voice audio involved).
 * Covers spec E2E scenarios 1–11 and 13 at the server boundary the voice gateway calls.
 */
const db = Db.fromUrl(process.env.DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:54329/postgres');
let orgId: string;
let otherOrgId: string;
let mark: string;
let aoife: string;
let fade: string;
let otherService: string;
// A Tuesday at least 3 days out, so lead-time rules never interfere.
const day = (() => {
  let d = DateTime.now().setZone('Europe/Dublin').plus({ days: 3 }).startOf('day');
  while (d.weekday !== 2) d = d.plus({ days: 1 });
  return d.toISODate()!;
})();

async function createBarbershop(name: string): Promise<{ org: string; mark: string; aoife: string; fade: string }> {
  const org = (
    await db.query(
      `insert into public.organizations (name, slug, industry_template_id, country, timezone, primary_language, status, fallback_phone_e164)
       values ($1, $2, 'barbershop', 'IE', 'Europe/Dublin', 'en', 'active', '+353911234567') returning id`,
      [name, `shop-${randomUUID().slice(0, 8)}`],
    )
  ).rows[0].id;
  const loc = (await db.query(`insert into public.locations (organization_id, name, is_primary, address_line, city) values ($1, 'Main', true, '1 Shop Street', 'Galway') returning id`, [org])).rows[0].id;
  for (let wd = 2; wd <= 6; wd++) {
    await db.query(`insert into public.business_hours (organization_id, location_id, weekday, opens, closes) values ($1, $2, $3, '09:00', '18:00')`, [org, loc, wd]);
  }
  await db.query(`insert into public.booking_rules (organization_id, slot_interval_min, min_lead_min) values ($1, 15, 60)`, [org]);
  const staff = async (n: string, from: string, to: string) => {
    const id = (await db.query(`insert into public.staff_members (organization_id, display_name, location_id) values ($1, $2, $3) returning id`, [org, n, loc])).rows[0].id;
    for (let wd = 2; wd <= 6; wd++) await db.query(`insert into public.staff_hours (organization_id, staff_id, weekday, starts, ends) values ($1, $2, $3, $4, $5)`, [org, id, wd, from, to]);
    return id as string;
  };
  const m = await staff('Mark', '12:00', '18:00');
  const a = await staff('Aoife', '09:00', '18:00');
  const s = (
    await db.query(
      `insert into public.services (organization_id, names, duration_min, buffer_after_min, price_minor, price_approved) values ($1, '{"en":"Skin fade","hr":"Skin fade"}', 45, 15, 2500, true) returning id`,
      [org],
    )
  ).rows[0].id;
  await db.query(`insert into public.services (organization_id, names, duration_min, price_minor, price_approved) values ($1, '{"en":"Hot towel shave"}', 30, 3000, false)`, [org]);
  return { org, mark: m, aoife: a, fade: s };
}

function session(org: string, caps: Capability[] = ['reception', 'booking', 'rescheduling', 'cancellation', 'messages', 'human_handoff'], callerId: string | null = '+353871234567'): CallSession {
  return {
    ctx: {
      organizationId: org,
      callId: '',
      agentVersionId: 'v1',
      enabledCapabilities: caps,
      agentToolAllowlist: toolsForCapabilities(caps),
      verifiedBookingIds: new Set(),
      offeredSlots: new Set(),
      toolCallsSoFar: 0,
      consequentialCallsSoFar: 0,
      organizationStatus: 'active',
    },
    callerIdE164: callerId,
    timezone: 'Europe/Dublin',
    language: 'en',
    verificationAttempts: 0,
  };
}

async function startCall(s: CallSession): Promise<CallSession> {
  s.ctx.callId = (
    await db.query(`insert into public.calls (organization_id, provider, provider_call_id, started_at, from_e164) values ($1, 'test', $2, now(), $3) returning id`, [
      s.ctx.organizationId,
      randomUUID(),
      s.callerIdE164,
    ])
  ).rows[0].id;
  return s;
}

beforeAll(async () => {
  const a = await createBarbershop("Mark's Barbers");
  orgId = a.org;
  mark = a.mark;
  aoife = a.aoife;
  fade = a.fade;
  const b = await createBarbershop('Other Shop');
  otherOrgId = b.org;
  otherService = b.fade;
});
afterAll(async () => {
  await db.end();
});

describe('caller books, reschedules and cancels (E2E 4–10)', () => {
  const booking = new BookingService({ db });
  const tools = new ToolExecutor({ db, booking });

  it('renders verified business facts, hiding unapproved prices', async () => {
    const facts = await renderBusinessFacts(db, orgId, 'en');
    expect(facts).toMatch(/Skin fade \[.*\]: 45 min, €25\.00/);
    expect(facts).toMatch(/Hot towel shave .*price not available/);
    expect(facts).toMatch(/Monday: closed/);
  });

  it('"skin fade with Mark tomorrow afternoon" → offers only Mark’s valid times → books → confirmed', async () => {
    const s = await startCall(session(orgId));
    const avail = await tools.execute(s, 'check_availability', { service_id: fade, staff_id: mark, date: day, day_part: 'afternoon' });
    expect(avail.ok).toBe(true);
    const options = avail.data!.options as Array<{ staff_id: string; start: string; spoken: string }>;
    expect(options.length).toBeGreaterThan(0);
    expect(options.every((o) => o.staff_id === mark)).toBe(true);
    expect(options[0]!.spoken).toMatch(/^Tuesday .* at (12|1|2|3|4):\d\d pm$/);

    const chosen = options[0]!;
    const res = await tools.execute(s, 'book_appointment', {
      service_id: fade, staff_id: chosen.staff_id, start: chosen.start, customer_name: 'Seán Murphy', customer_phone: '+353871234567', caller_confirmed: true,
    });
    expect(res.ok).toBe(true);
    expect(res.data!.status).toBe('confirmed');
    expect(res.data!.reference_spoken).toMatch(/^\d( \d){5}$/);

    // The client sees it (E2E 7) and a confirmation is queued exactly once (E2E 8).
    const appt = await db.query(`select status, source from public.appointments where id = $1`, [res.data!.booking_id]);
    expect(appt.rows[0]).toEqual({ status: 'confirmed', source: 'voice' });
    const jobs = await db.query(`select count(*)::int as n from public.jobs where dedupe_key = $1`, [`booking_confirmed:${res.data!.booking_id}`]);
    expect(jobs.rows[0].n).toBe(1);

    // Replayed tool call (provider retry) is idempotent: same booking, same reference, no duplicate.
    const replay = await tools.execute(s, 'book_appointment', {
      service_id: fade, staff_id: chosen.staff_id, start: chosen.start, customer_name: 'Seán Murphy', customer_phone: '+353871234567', caller_confirmed: true,
    });
    expect(replay.data!.booking_id).toBe(res.data!.booking_id);
    expect(replay.data!.reference_spoken).toBe(res.data!.reference_spoken);

    // The slot is no longer offered.
    const again = await booking.checkAvailability(orgId, { serviceId: fade, staffId: mark, date: day, dayPart: 'afternoon', maxOptions: 50 });
    expect(again.ok && again.options.some((o) => o.start === chosen.start)).toBe(false);

    // Later call: caller verifies with reference + caller ID, reschedules, then cancels.
    const s2 = await startCall(session(orgId));
    const ref = (res.data!.reference_spoken as string).replace(/ /g, '');
    const bad = await tools.execute(s2, 'cancel_booking', { booking_id: res.data!.booking_id, caller_confirmed: true });
    expect(bad.ok).toBe(false); // not verified yet
    const v = await tools.execute(s2, 'verify_caller_booking', { reference: ref });
    expect(v.ok).toBe(true);

    const later = await tools.execute(s2, 'check_availability', { service_id: fade, staff_id: aoife, date: day, day_part: 'morning' });
    const target = (later.data!.options as Array<{ staff_id: string; start: string }>)[0]!;
    const moved = await tools.execute(s2, 'reschedule_booking', { booking_id: res.data!.booking_id, new_start: target.start, staff_id: target.staff_id, caller_confirmed: true });
    expect(moved.data!.status).toBe('confirmed');
    const old = await db.query(`select status from public.appointments where id = $1`, [res.data!.booking_id]);
    expect(old.rows[0].status).toBe('cancelled');

    const cancelled = await tools.execute(s2, 'cancel_booking', { booking_id: moved.data!.booking_id, caller_confirmed: true });
    expect(cancelled.data!.status).toBe('cancelled');
  });

  it('someone who only knows the name/number cannot touch the booking', async () => {
    const s = await startCall(session(orgId));
    const avail = await tools.execute(s, 'check_availability', { service_id: fade, date: day, day_part: 'any' });
    const o = (avail.data!.options as Array<{ staff_id: string; start: string }>)[1]!;
    const res = await tools.execute(s, 'book_appointment', { service_id: fade, staff_id: o.staff_id, start: o.start, customer_name: 'Niamh Kelly', customer_phone: '+353861112222', caller_confirmed: true });
    expect(res.data!.status).toBe('confirmed');

    const impostor = await startCall(session(orgId, undefined, '+353869999999'));
    expect((await tools.execute(impostor, 'verify_caller_booking', { reference: '123456' })).ok).toBe(false);
    // Right reference, but caller ID and stated phone do not match.
    const ref = (res.data!.reference_spoken as string).replace(/ /g, '');
    expect((await tools.execute(impostor, 'verify_caller_booking', { reference: ref, stated_phone: '+353869999999' })).ok).toBe(false);
    expect((await tools.execute(impostor, 'verify_caller_booking', { reference: ref })).ok).toBe(false);
    const fourth = await tools.execute(impostor, 'verify_caller_booking', { reference: ref, stated_phone: '+353861112222' });
    expect(fourth.ok).toBe(false); // attempts exhausted even with the right details
    expect(fourth.guidance).toMatch(/too many/i);
  });

  it('two callers racing for the same slot: one booked, the other told it was just taken (E2E 11)', async () => {
    const s1 = await startCall(session(orgId));
    const s2 = await startCall(session(orgId, undefined, '+353872223333'));
    const a1 = await tools.execute(s1, 'check_availability', { service_id: fade, staff_id: aoife, date: day, day_part: 'afternoon' });
    const slot = (a1.data!.options as Array<{ staff_id: string; start: string }>)[0]!;
    await tools.execute(s2, 'check_availability', { service_id: fade, staff_id: aoife, date: day, day_part: 'afternoon' });
    const args = (phone: string) => ({ service_id: fade, staff_id: slot.staff_id, start: slot.start, customer_name: 'Racer', customer_phone: phone, caller_confirmed: true });
    const [r1, r2] = await Promise.all([tools.execute(s1, 'book_appointment', args('+353871234567')), tools.execute(s2, 'book_appointment', args('+353872223333'))]);
    const statuses = [r1.data!.status, r2.data!.status].sort();
    expect(statuses).toEqual(['confirmed', 'slot_unavailable']);
  });

  it('a tenant cannot book another tenant’s service, even with a valid id', async () => {
    const s = await startCall(session(orgId));
    const r = await tools.execute(s, 'check_availability', { service_id: otherService, date: day, day_part: 'any' });
    expect(r.ok).toBe(false);
    const direct = await booking.book(orgId, { serviceId: otherService, staffId: mark, start: `${day}T13:00:00Z`, customerName: 'X', customerPhone: '+353871234567', source: 'voice', idempotencyKey: randomUUID() });
    expect(direct.status).toBe('slot_unavailable');
    expect(otherOrgId).not.toBe(orgId);
  });

  it('the agent cannot book a time it was never offered', async () => {
    const s = await startCall(session(orgId));
    const r = await tools.execute(s, 'book_appointment', { service_id: fade, staff_id: mark, start: `${day}T03:00:00Z`, customer_name: 'X', customer_phone: '+353871234567', caller_confirmed: true });
    expect(r.ok).toBe(false);
    expect(r.guidance).toMatch(/not offered/);
  });

  it('messages and transfers', async () => {
    const s = await startCall(session(orgId));
    const m = await tools.execute(s, 'take_message', { caller_name: 'Pat', callback_phone: '+353871234567', message: 'Do you do gift vouchers?' });
    expect(m.ok).toBe(true);
    const t = await tools.execute(s, 'transfer_to_human', { reason: 'caller asked for a person' });
    expect(t.action).toEqual({ type: 'transfer', target: '+353911234567' });
    const events = await db.query(`select type, payload from public.call_events where call_id = $1 order by id`, [s.ctx.callId]);
    expect(events.rows.map((e) => e.type)).toEqual(['tool.requested', 'tool.result', 'tool.requested', 'tool.result']);
    expect(JSON.stringify(events.rows)).not.toContain('Do you do gift vouchers'); // PII redacted from the trace
    expect(JSON.stringify(events.rows)).not.toContain('+353871234567');
  });
});

describe('external calendar failures are never reported as success (E2E 13)', () => {
  function fakeCalendar(behaviour: 'unknown' | 'down'): CalendarAdapter {
    return {
      kind: 'google',
      listBusy: async () => [],
      createBooking: async () => {
        throw behaviour === 'unknown' ? new CalendarOutcomeUnknownError('timeout') : new CalendarUnavailableError('503');
      },
      findByIdempotencyKey: async () => null,
      moveBooking: async () => ({ externalId: 'x' }),
      cancelBooking: async () => undefined,
    };
  }

  it('timeout after send → pending_check + reconciliation job, never "confirmed"', async () => {
    const booking = new BookingService({ db, resolveCalendar: async () => ({ adapter: fakeCalendar('unknown'), calendarId: 'cal' }) });
    const tools = new ToolExecutor({ db, booking });
    const s = await startCall(session(orgId));
    const a = await tools.execute(s, 'check_availability', { service_id: fade, staff_id: aoife, date: day, day_part: 'evening' });
    const slot = (a.data!.options as Array<{ staff_id: string; start: string }>)[0]!;
    const r = await tools.execute(s, 'book_appointment', { service_id: fade, staff_id: slot.staff_id, start: slot.start, customer_name: 'Ciara', customer_phone: '+353873334444', caller_confirmed: true });
    expect(r.ok).toBe(false);
    expect(r.data!.status).toBe('pending_check');
    expect(r.guidance).toMatch(/Do NOT say it is confirmed/);
    const jobs = await db.query(`select count(*)::int as n from public.jobs where kind = 'reconcile_booking' and organization_id = $1`, [orgId]);
    expect(jobs.rows[0].n).toBeGreaterThan(0);
  });

  it('calendar down → caller is offered a message instead', async () => {
    const booking = new BookingService({ db, resolveCalendar: async () => ({ adapter: fakeCalendar('down'), calendarId: 'cal' }) });
    const tools = new ToolExecutor({ db, booking });
    const s = await startCall(session(orgId));
    const a = await tools.execute(s, 'check_availability', { service_id: fade, staff_id: mark, date: day, day_part: 'evening' });
    const slot = (a.data!.options as Array<{ staff_id: string; start: string }>)[0]!;
    const r = await tools.execute(s, 'book_appointment', { service_id: fade, staff_id: slot.staff_id, start: slot.start, customer_name: 'Ciara', customer_phone: '+353873334444', caller_confirmed: true });
    expect(r.data!.status).toBe('calendar_unavailable');
    const failed = await db.query(`select status from public.appointments where organization_id = $1 and starts_at = $2 order by created_at desc limit 1`, [orgId, slot.start]);
    expect(failed.rows[0].status).toBe('failed');
  });
});
