import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import {
  BookingService,
  ConsoleEmailSender,
  ConsoleSmsSender,
  Db,
  createHandlers,
  provisionClient,
  runJobsOnce,
  schedulePeriodicJobs,
} from '../src/index';

const db = Db.fromUrl(process.env.DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:54329/postgres');
const email = new ConsoleEmailSender();
const sms = new ConsoleSmsSender();
let org: string;
let staffId: string;
let serviceId: string;

async function drain(): Promise<void> {
  const handlers = createHandlers({ db, email, sms, siteUrl: 'https://app.example.test', staleCommitSeconds: 0 });
  for (let i = 0; i < 10; i++) {
    await db.query(`update public.jobs set run_at = now() where status = 'queued'`);
    const r = await runJobsOnce(db, handlers, 'test-worker', 50);
    if (r.claimed === 0) return;
  }
}

beforeAll(async () => {
  await db.query(`update public.jobs set status = 'succeeded' where status in ('queued', 'running')`); // isolate from other suites
  const r = await provisionClient(
    db,
    {
      businessName: 'Worker Test Barbers',
      industry: 'barbershop',
      country: 'IE',
      primaryLanguage: 'en',
      contactEmail: 'owner@shop.test',
      ownerEmail: 'owner@shop.test',
      hours: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, opens: '00:00', closes: '23:45' })),
      staff: [{ name: 'Mark' }],
    },
    { actorUserId: null, idempotencyKey: randomUUID() },
  );
  org = r.organizationId;
  await db.query(`update public.organizations set status = 'active' where id = $1`, [org]);
  await db.query(`update public.booking_rules set min_lead_min = 0 where organization_id = $1`, [org]);
  staffId = (await db.query(`select id from public.staff_members where organization_id = $1`, [org])).rows[0].id;
  serviceId = (await db.query(`select id from public.services where organization_id = $1 order by sort_order limit 1`, [org])).rows[0].id;
});
afterAll(() => db.end());

describe('background worker', () => {
  it('a confirmed voice booking produces exactly one owner email, and no customer SMS unless enabled', async () => {
    const booking = new BookingService({ db });
    const day = DateTime.now().setZone('Europe/Dublin').plus({ days: 3 }).toISODate()!;
    const avail = await booking.checkAvailability(org, { serviceId, date: day, dayPart: 'afternoon' });
    if (!avail.ok) throw new Error('no availability');
    const slot = avail.options[0]!;
    const r = await booking.book(org, { serviceId, staffId: slot.staffId, start: slot.start, customerName: 'Aoife', customerPhone: '+353871112233', source: 'voice', idempotencyKey: randomUUID() });
    expect(r.status).toBe('confirmed');
    await drain();
    await drain(); // second pass must not resend
    const toOwner = email.sent.filter((m) => m.to === 'owner@shop.test' && /New booking/.test(m.subject));
    expect(toOwner).toHaveLength(1);
    expect(toOwner[0]!.text).toMatch(/Aoife booked Haircut with Mark/);
    expect(sms.sent).toHaveLength(0); // template default has sms_confirmations off
    const n = await db.query(`select status from public.notifications where organization_id = $1`, [org]);
    expect(n.rows.every((x) => x.status === 'sent')).toBe(true);
  });

  it('enquiry alerts never include sensitive fields', async () => {
    const id = randomUUID();
    await db.query(
      `insert into public.enquiries (id, organization_id, kind, urgency, caller_name, callback_phone_e164, summary, fields, sensitive_fields)
       values ($1, $2, 'lead', 'urgent', 'Pat', '+353871234567', 'Wants a consultation', '{"practice_area":"employment"}', '{"other_parties":"ACME Ltd"}')`,
      [id, org],
    );
    await db.query(`insert into public.jobs (kind, organization_id, payload) values ('notify_staff_enquiry', $1, $2)`, [org, JSON.stringify({ enquiryId: id })]);
    await drain();
    const m = email.sent.find((x) => /Urgent/.test(x.subject));
    expect(m?.text).toMatch(/practice area: employment/);
    expect(m?.text).toContain('https://app.example.test/app/');
    expect(m?.text).not.toContain('ACME');
  });

  it('stale "committing" bookings are moved to reconciliation and the owner is asked to check', async () => {
    const day = DateTime.now().setZone('Europe/Dublin').plus({ days: 4 }).set({ hour: 15 }).toUTC();
    const id = randomUUID();
    await db.query(
      `insert into public.appointments (id, organization_id, staff_id, service_id, status, starts_at, ends_at, block_start, block_end, hold_expires_at, source, idempotency_key)
       values ($1, $2, $3, $4, 'holding', $5, $6, $5, $6, now() + interval '5 min', 'voice', $7)`,
      [id, org, staffId, serviceId, day.toISO(), day.plus({ minutes: 30 }).toISO(), randomUUID()],
    );
    await db.query(`update public.appointments set status = 'committing', updated_at = now() - interval '10 minutes' where id = $1`, [id]);
    await db.query(`insert into public.jobs (kind) values ('sweep_bookings')`);
    await drain();
    const s = await db.query(`select status from public.appointments where id = $1`, [id]);
    expect(s.rows[0].status).toBe('needs_reconciliation'); // never silently confirmed or dropped
    expect(email.sent.some((m) => /Please check a booking/.test(m.subject))).toBe(true);
  });

  it('dead-letters unknown job kinds and retries failures with backoff', async () => {
    await db.query(`insert into public.jobs (kind, dedupe_key) values ('no_such_kind', $1)`, [randomUUID()]);
    const failing = new ConsoleEmailSender();
    failing.send = async () => {
      throw new Error('provider down');
    };
    await db.query(
      `insert into public.notifications (id, organization_id, channel, template, language, recipient, dedupe_key, payload)
       values ($1, $2, 'email', 'enquiry_staff', 'en', 'x@y.test', $3, '{"subject":"s","text":"t"}')`,
      [randomUUID(), org, randomUUID()],
    );
    const nid = (await db.query(`select id from public.notifications where recipient = 'x@y.test'`)).rows[0].id;
    await db.query(`insert into public.jobs (kind, organization_id, payload) values ('deliver_notification', $1, $2)`, [org, JSON.stringify({ notificationId: nid })]);
    const handlers = createHandlers({ db, email: failing, sms: null, siteUrl: 'x' });
    const r = await runJobsOnce(db, handlers, 'w', 50);
    expect(r.dead).toBeGreaterThanOrEqual(1);
    expect(r.failed).toBeGreaterThanOrEqual(1);
    const n = await db.query(`select status, error from public.notifications where id = $1`, [nid]);
    expect(n.rows[0]).toMatchObject({ status: 'failed', error: 'provider down' });
  });

  it('periodic jobs are created once per time bucket, however many workers schedule them', async () => {
    const t = new Date('2030-05-05T10:07:30Z');
    await Promise.all([schedulePeriodicJobs(db, t), schedulePeriodicJobs(db, t), schedulePeriodicJobs(db, t)]);
    const { rows } = await db.query(`select count(*)::int as n from public.jobs where dedupe_key like '%2030-05-05%'`);
    expect(rows[0].n).toBe(5);
  });

  it('usage roll-up fills the monthly table', async () => {
    await db.query(`insert into public.jobs (kind) values ('rollup_usage')`);
    await drain();
    const { rows } = await db.query(`select bookings from public.usage_monthly where organization_id = $1`, [org]);
    expect(rows[0].bookings).toBeGreaterThanOrEqual(1);
  });
});
