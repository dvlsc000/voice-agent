import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import { BookingService, Db, eraseSubjectData, exportSubjectData, normaliseSubject, provisionClient } from '../src/index';

const db = Db.fromUrl(process.env.DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:54329/postgres');
let org: string;
let otherOrg: string;
const phone = '+353879998877';
afterAll(() => db.end());

beforeAll(async () => {
  const mk = async (name: string) => {
    const r = await provisionClient(db, { businessName: name, industry: 'barbershop', country: 'IE', primaryLanguage: 'en', contactEmail: 'o@p.test', ownerEmail: 'o@p.test',
      hours: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, opens: '09:00', closes: '18:00' })), staff: [{ name: 'Mark' }] }, { actorUserId: null, idempotencyKey: randomUUID() });
    await db.query(`update public.organizations set status = 'active' where id = $1`, [r.organizationId]);
    await db.query(`update public.booking_rules set min_lead_min = 0 where organization_id = $1`, [r.organizationId]);
    return r.organizationId;
  };
  org = await mk('Privacy Barbers');
  otherOrg = await mk('Other Privacy Barbers');
  for (const o of [org, otherOrg]) {
    const svc = (await db.query(`select id from public.services where organization_id = $1 order by sort_order limit 1`, [o])).rows[0].id;
    const b = new BookingService({ db });
    const day = DateTime.now().setZone('Europe/Dublin').plus({ days: 2 }).toISODate()!;
    const a = await b.checkAvailability(o, { serviceId: svc, date: day, dayPart: 'any' });
    if (!a.ok) throw new Error();
    const callId = (await db.query(`insert into public.calls (organization_id, provider, provider_call_id, started_at, from_e164, summary) values ($1, 'sim', $2, now(), $3, 'Booked a haircut') returning id`, [o, randomUUID(), phone])).rows[0].id;
    await db.query(`insert into public.call_transcripts (call_id, organization_id, segments, retain_until) values ($1, $2, '[{"role":"caller","text":"Hi it is Orla Byrne"}]', now() + interval '90 days')`, [callId, o]);
    await b.book(o, { serviceId: svc, staffId: a.options[0]!.staffId, start: a.options[0]!.start, customerName: 'Orla Byrne', customerPhone: phone, source: 'voice', idempotencyKey: randomUUID(), callId });
    await db.query(`insert into public.enquiries (organization_id, kind, caller_name, callback_phone_e164, summary) values ($1, 'message', 'Orla', $2, 'Call me back')`, [o, phone]);
  }
});

describe('data subject requests', () => {
  it('normalises identifiers', () => {
    expect(normaliseSubject({ phone: '087 999 8877' }, 'IE')).toEqual({ phoneE164: phone, email: null });
    expect(() => normaliseSubject({ phone: '12' }, 'IE')).toThrow();
  });

  it('access: exports everything about the person in this business only', async () => {
    const e = await exportSubjectData(db, org, { phoneE164: phone, email: null });
    expect((e.customer_records as unknown[]).length).toBe(1);
    expect((e.appointments as unknown[]).length).toBe(1);
    expect(JSON.stringify(e.calls)).toContain('Orla Byrne');
    expect((e.messages as unknown[]).length).toBe(1);
  });

  it('erasure: removes personal data, keeps anonymous records, and does not touch other businesses', async () => {
    const r = await eraseSubjectData(db, org, { phoneE164: phone, email: null }, null);
    expect(r).toMatchObject({ customers: 1, transcripts: 1, calls_anonymised: 1, messages: 1 });
    const after = await exportSubjectData(db, org, { phoneE164: phone, email: null });
    expect(after.customer_records).toEqual([]);
    expect(after.calls).toEqual([]);
    expect(after.messages).toEqual([]);
    const appts = (await db.query(`select count(*)::int as n, count(customer_id)::int as linked from public.appointments where organization_id = $1`, [org])).rows[0];
    expect(appts).toEqual({ n: 1, linked: 0 }); // slot history kept, person unlinked
    const audit = (await db.query(`select count(*)::int as n from public.audit_logs where organization_id = $1 and (old_data::text like '%Orla%' or new_data::text like '%Orla%')`, [org])).rows[0].n;
    expect(audit).toBe(0);
    const req = (await db.query(`select subject_phone_e164, status from public.privacy_requests where organization_id = $1`, [org])).rows[0];
    expect(req).toEqual({ subject_phone_e164: '+353***77', status: 'completed' }); // the log itself doesn't re-identify the person
    const other = await exportSubjectData(db, otherOrg, { phoneE164: phone, email: null });
    expect((other.customer_records as unknown[]).length).toBe(1);
  });
});
