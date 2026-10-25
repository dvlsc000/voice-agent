import { describe, expect, it } from 'vitest';
import { computeAvailableSlots, localToInstant, pickSpokenOptions, type AvailabilityQuery } from '../src/index';

const MARK = '11111111-1111-4111-8111-111111111111';
const AOIFE = '22222222-2222-4222-8222-222222222222';
const weekdays = { 1: [{ start: '09:00', end: '17:00' }], 2: [{ start: '09:00', end: '17:00' }], 3: [{ start: '09:00', end: '17:00' }], 4: [{ start: '09:00', end: '17:00' }], 5: [{ start: '09:00', end: '17:00' }] };

function base(over: Partial<AvailabilityQuery> = {}): AvailabilityQuery {
  return {
    timezone: 'Europe/Dublin',
    from: '2026-11-03T00:00:00Z', // Tuesday
    to: '2026-11-04T00:00:00Z',
    now: '2026-11-01T12:00:00Z',
    service: { id: 'fade', durationMin: 45 },
    businessHours: weekdays,
    staff: [
      { staffId: MARK, weekly: { 2: [{ start: '12:00', end: '17:00' }] } },
      { staffId: AOIFE, weekly: weekdays },
    ],
    busy: [],
    slotIntervalMin: 15,
    minLeadMin: 60,
    ...over,
  };
}

describe('computeAvailableSlots', () => {
  it('only offers times where the whole service fits inside staff and business hours', () => {
    const slots = computeAvailableSlots(base({ staffId: MARK }));
    expect(slots[0]!.start).toBe('2026-11-03T12:00:00.000Z'); // GMT in November
    expect(slots.at(-1)!.start).toBe('2026-11-03T16:15:00.000Z'); // 16:15 + 45 = 17:00
    expect(slots.every((s) => s.staffId === MARK)).toBe(true);
  });

  it('excludes slots whose buffered window overlaps busy time', () => {
    const slots = computeAvailableSlots(
      base({
        staffId: MARK,
        service: { id: 'fade', durationMin: 30, bufferAfterMin: 15 },
        busy: [{ staffId: MARK, start: '2026-11-03T13:00:00Z', end: '2026-11-03T13:30:00Z' }],
      }),
    );
    const starts = slots.map((s) => s.start.slice(11, 16));
    // 12:15 ends 12:45, buffer to 13:00 → allowed. 12:30 ends 13:00 + buffer 13:15 overlaps → excluded.
    expect(starts).toContain('12:15');
    expect(starts).not.toContain('12:30');
    expect(starts).not.toContain('13:00');
    expect(starts).toContain('13:30');
  });

  it('respects holiday closures and special hours', () => {
    expect(computeAvailableSlots(base({ businessExceptions: [{ date: '2026-11-03', closed: true }] }))).toEqual([]);
    const special = computeAvailableSlots(
      base({ staffId: AOIFE, businessExceptions: [{ date: '2026-11-03', closed: false, ranges: [{ start: '10:00', end: '11:00' }] }] }),
    );
    expect(special.map((s) => s.start.slice(11, 16))).toEqual(['10:00', '10:15']);
  });

  it('enforces minimum lead time from "now"', () => {
    const slots = computeAvailableSlots(base({ staffId: AOIFE, now: '2026-11-03T10:50:00Z' }));
    expect(slots[0]!.start).toBe('2026-11-03T12:00:00.000Z');
  });

  it('only offers qualified staff for a service', () => {
    const slots = computeAvailableSlots(base({ service: { id: 'fade', durationMin: 45, staffIds: [AOIFE] } }));
    expect(new Set(slots.map((s) => s.staffId))).toEqual(new Set([AOIFE]));
  });

  it('handles the spring-forward DST change (Dublin, 29 Mar 2026)', () => {
    expect(localToInstant('2026-03-27', '09:00', 'Europe/Dublin').toUTC().toISO()).toBe('2026-03-27T09:00:00.000Z');
    expect(localToInstant('2026-03-30', '09:00', 'Europe/Dublin').toUTC().toISO()).toBe('2026-03-30T08:00:00.000Z');
    expect(localToInstant('2026-03-30', '09:00', 'Europe/Zagreb').toUTC().toISO()).toBe('2026-03-30T07:00:00.000Z');
  });

  it('handles the fall-back DST day itself (Dublin, Sun 25 Oct 2026)', () => {
    const slots = computeAvailableSlots(
      base({
        from: '2026-10-25T00:00:00Z',
        to: '2026-10-26T00:00:00Z',
        now: '2026-10-20T00:00:00Z',
        service: { id: 'cut', durationMin: 30 },
        businessHours: { 7: [{ start: '10:00', end: '14:00' }] },
        staff: [{ staffId: AOIFE, weekly: { 7: [{ start: '10:00', end: '14:00' }] } }],
        slotIntervalMin: 30,
      }),
    );
    expect(slots).toHaveLength(8);
    expect(slots[0]!.start).toBe('2026-10-25T10:00:00.000Z'); // GMT after 02:00 local change
    expect(slots[0]!.localStart).toBe('2026-10-25T10:00:00+00:00');
  });

  it('a slot booked in summer still reads correctly in local time', () => {
    const slots = computeAvailableSlots(
      base({ timezone: 'Europe/Zagreb', from: '2026-07-07T00:00:00Z', to: '2026-07-08T00:00:00Z', now: '2026-07-01T00:00:00Z', staffId: AOIFE }),
    );
    expect(slots[0]!.localStart).toBe('2026-07-07T09:00:00+02:00');
    expect(slots[0]!.start).toBe('2026-07-07T07:00:00.000Z');
  });

  it('rejects unknown timezones', () => {
    expect(() => computeAvailableSlots(base({ timezone: 'Mars/Olympus' }))).toThrow(/timezone/i);
  });
});

describe('pickSpokenOptions', () => {
  it('returns at most N spread-out, distinct times', () => {
    const slots = computeAvailableSlots(base());
    const picked = pickSpokenOptions(slots, 3, 60);
    expect(picked).toHaveLength(3);
    expect(new Set(picked.map((p) => p.start)).size).toBe(3);
    const gaps = picked.slice(1).map((p, i) => Date.parse(p.start) - Date.parse(picked[i]!.start));
    expect(gaps.every((g) => g >= 60 * 60_000)).toBe(true);
  });
});
