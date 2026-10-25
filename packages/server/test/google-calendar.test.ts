import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import { CalendarOutcomeUnknownError, CalendarUnavailableError } from '@vp/core';
import {
  BookingService,
  Db,
  GoogleCalendarAdapter,
  GoogleRefreshTokenProvider,
  MemorySecretStore,
  calendarResolver,
  createHandlers,
  ConsoleEmailSender,
  googleEventId,
  provisionClient,
  runJobsOnce,
  saveCalendarConnection,
} from '../src/index';

/** In-memory stand-in for the Google Calendar + OAuth token endpoints, following the documented contract. */
class FakeGoogle {
  events = new Map<string, { id: string; start: string; end: string; status: string; summary: string }>();
  busy: Array<{ start: string; end: string }> = [];
  tokenRefreshes = 0;
  revoked = false;
  expireNextToken = false;
  timeoutNextCreateAfterWrite = false;
  fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
    if (url.host === 'oauth2.googleapis.com') {
      this.tokenRefreshes++;
      if (this.revoked) return json(400, { error: 'invalid_grant' });
      return json(200, { access_token: `at-${this.tokenRefreshes}`, expires_in: 3600 });
    }
    const auth = (init?.headers as Record<string, string>).authorization;
    if (this.expireNextToken) {
      this.expireNextToken = false;
      return json(401, { error: { code: 401 } });
    }
    if (!auth?.startsWith('Bearer at-')) return json(401, {});
    const path = url.pathname.replace('/calendar/v3', '');
    if (path === '/freeBusy' && method === 'POST') {
      const body = JSON.parse(String(init!.body));
      const all = [...this.busy, ...[...this.events.values()].filter((e) => e.status !== 'cancelled').map((e) => ({ start: e.start, end: e.end }))];
      return json(200, { calendars: Object.fromEntries(body.items.map((i: { id: string }) => [i.id, { busy: all }])) });
    }
    const m = path.match(/^\/calendars\/([^/]+)\/events(?:\/([^/?]+))?$/);
    if (!m) return json(404, {});
    const id = m[2];
    if (method === 'POST' && !id) {
      const b = JSON.parse(String(init!.body));
      if (this.events.has(b.id)) return json(409, { error: { code: 409, message: 'The requested identifier already exists.' } });
      this.events.set(b.id, { id: b.id, start: b.start.dateTime, end: b.end.dateTime, status: 'confirmed', summary: b.summary });
      if (this.timeoutNextCreateAfterWrite) {
        this.timeoutNextCreateAfterWrite = false;
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      }
      return json(200, { id: b.id, etag: '"1"' });
    }
    const ev = id ? this.events.get(id) : undefined;
    if (method === 'GET') return ev ? json(200, ev) : json(404, {});
    if (method === 'PATCH' && ev) {
      const b = JSON.parse(String(init!.body));
      ev.start = b.start.dateTime;
      ev.end = b.end.dateTime;
      return json(200, { id: ev.id, etag: '"2"' });
    }
    if (method === 'DELETE') {
      if (!ev) return json(410, {});
      ev.status = 'cancelled';
      return new Response(null, { status: 204 });
    }
    return json(404, {});
  };
}

const db = Db.fromUrl(process.env.DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:54329/postgres');
const google = new FakeGoogle();
const secrets = new MemorySecretStore();
const creds = { clientId: 'cid', clientSecret: 'secret' };
let org: string;
let staffId: string;
let serviceId: string;
let connectionId: string;
const day = DateTime.now().setZone('Europe/Dublin').plus({ days: 3 }).toISODate()!;

beforeAll(async () => {
  const r = await provisionClient(db, {
    businessName: 'Google Barbers', industry: 'barbershop', country: 'IE', primaryLanguage: 'en', contactEmail: 'o@gc.test', ownerEmail: 'o@gc.test',
    hours: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, opens: '09:00', closes: '18:00' })), staff: [{ name: 'Mark' }],
  }, { actorUserId: null, idempotencyKey: randomUUID() });
  org = r.organizationId;
  await db.query(`update public.organizations set status = 'active' where id = $1`, [org]);
  staffId = (await db.query(`select id from public.staff_members where organization_id = $1`, [org])).rows[0].id;
  serviceId = (await db.query(`select id from public.services where organization_id = $1 order by sort_order limit 1`, [org])).rows[0].id;
  connectionId = await saveCalendarConnection(db, secrets, { organizationId: org, provider: 'google_calendar', refreshToken: 'rt-1', accountLabel: 'mark@gmail.test', scopes: ['calendar.events'], actorUserId: null });
  await db.query(`update public.staff_members set calendar_connection_id = $2, external_calendar_id = 'mark@gmail.test' where id = $1`, [staffId, connectionId]);
});
afterAll(() => db.end());

describe('Google Calendar adapter contract', () => {
  it('stores the refresh token only in the secret store, never in our tables', async () => {
    expect([...secrets.values.values()]).toContain('rt-1');
    const row = await db.query(`select * from public.integration_connections where id = $1`, [connectionId]);
    expect(JSON.stringify(row.rows)).not.toContain('rt-1');
  });

  it('event ids are deterministic and valid base32hex', () => {
    const id = googleEventId('call-1:book:x');
    expect(id).toMatch(/^[0-9a-v]{5,1024}$/);
    expect(googleEventId('call-1:book:x')).toBe(id);
  });

  it('booking through the engine creates exactly one Google event, even when retried', async () => {
    const booking = new BookingService({ db, resolveCalendar: calendarResolver(db, secrets, creds, google.fetch) });
    const avail = await booking.checkAvailability(org, { serviceId, staffId, date: day, dayPart: 'morning' });
    if (!avail.ok) throw new Error();
    const slot = avail.options[0]!;
    const key = randomUUID();
    const r1 = await booking.book(org, { serviceId, staffId, start: slot.start, customerName: 'A', customerPhone: '+353871234567', source: 'voice', idempotencyKey: key });
    expect(r1.status).toBe('confirmed');
    const r2 = await booking.book(org, { serviceId, staffId, start: slot.start, customerName: 'A', customerPhone: '+353871234567', source: 'voice', idempotencyKey: key });
    expect(r2.status).toBe('confirmed');
    expect([...google.events.values()].filter((e) => e.start === slot.start)).toHaveLength(1);
    expect(google.events.get(googleEventId(key))).toBeDefined();
  });

  it('times already busy in Google are never offered', async () => {
    const before = await new BookingService({ db, resolveCalendar: calendarResolver(db, secrets, creds, google.fetch) }).checkAvailability(org, { serviceId, staffId, date: day, dayPart: 'afternoon', maxOptions: 100 });
    if (!before.ok) throw new Error();
    const first = before.options[0]!;
    google.busy.push({ start: first.start, end: first.end }); // the owner put a dentist appointment in their own calendar
    const after = await new BookingService({ db, resolveCalendar: calendarResolver(db, secrets, creds, google.fetch) }).checkAvailability(org, { serviceId, staffId, date: day, dayPart: 'afternoon', maxOptions: 100 });
    if (!after.ok) throw new Error();
    expect(after.options.some((o) => o.start === first.start)).toBe(false);
  });

  it('a timeout after Google saved the event ends confirmed via reconciliation — never double-booked, never lost', async () => {
    const resolver = calendarResolver(db, secrets, creds, google.fetch);
    const booking = new BookingService({ db, resolveCalendar: resolver });
    const avail = await booking.checkAvailability(org, { serviceId, staffId, date: day, dayPart: 'evening' });
    if (!avail.ok || !avail.options[0]) throw new Error('no evening slot');
    google.timeoutNextCreateAfterWrite = true;
    const r = await booking.book(org, { serviceId, staffId, start: avail.options[0].start, customerName: 'B', customerPhone: '+353861112222', source: 'voice', idempotencyKey: randomUUID() });
    expect(r.status).toBe('pending_check');
    const email = new ConsoleEmailSender();
    const handlers = createHandlers({ db, email, sms: null, siteUrl: 'x', resolveCalendar: resolver });
    await db.query(`update public.jobs set status = 'succeeded' where kind <> 'reconcile_booking' and status = 'queued'`);
    await runJobsOnce(db, handlers, 'w', 50);
    const s = await db.query(`select status, external_calendar_event_id from public.appointments where id = $1`, [(r as { appointmentId: string }).appointmentId]);
    expect(s.rows[0].status).toBe('confirmed');
    expect(s.rows[0].external_calendar_event_id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refreshes an expired access token once and carries on', async () => {
    const tokens = new GoogleRefreshTokenProvider({ ...creds, fetch: google.fetch, getRefreshToken: async () => 'rt-1' });
    const adapter = new GoogleCalendarAdapter({ tokens, fetch: google.fetch });
    const before = google.tokenRefreshes;
    google.expireNextToken = true;
    await adapter.listBusy({ staffCalendarIds: { [staffId]: 'primary' }, from: `${day}T00:00:00Z`, to: `${day}T23:00:00Z` });
    expect(google.tokenRefreshes - before).toBe(2); // initial + forced refresh after 401
  });

  it('revoked access marks the connection for reconnection and blocks booking instead of using the wrong diary', async () => {
    google.revoked = true;
    const booking = new BookingService({ db, resolveCalendar: calendarResolver(db, secrets, creds, google.fetch) });
    const avail = await booking.checkAvailability(org, { serviceId, staffId, date: day, dayPart: 'any' });
    expect(avail.ok && avail.options.length).toBe(0); // calendar unreadable → offer nothing for that staff member
    const conn = await db.query(`select status, last_error from public.integration_connections where id = $1`, [connectionId]);
    expect(conn.rows[0]).toMatchObject({ status: 'error', last_error: expect.stringMatching(/Reconnect/) });
    google.revoked = false;
  });

  it('errors map to the right failure types', async () => {
    const down: typeof fetch = async (input) =>
      String(input).includes('oauth2') ? new Response(JSON.stringify({ access_token: 'at-x', expires_in: 3600 }), { status: 200 }) : new Response('{}', { status: 503 });
    const adapter = new GoogleCalendarAdapter({ tokens: new GoogleRefreshTokenProvider({ ...creds, fetch: down, getRefreshToken: async () => 'rt' }), fetch: down });
    const slot = { staffId, start: `${day}T10:00:00.000Z`, end: `${day}T10:30:00.000Z`, blockStart: '', blockEnd: '', localStart: '' };
    await expect(adapter.createBooking({ slot, calendarId: 'c', title: 't', description: 'd', idempotencyKey: 'k' })).rejects.toBeInstanceOf(CalendarOutcomeUnknownError);
    await expect(adapter.listBusy({ staffCalendarIds: { a: 'c' }, from: slot.start, to: slot.end })).rejects.toBeInstanceOf(CalendarUnavailableError);
  });
});
