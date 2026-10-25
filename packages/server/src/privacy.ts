import { toE164 } from '@vp/core';
import type { Db, Queryable } from './db';

/**
 * GDPR data-subject requests for one business's callers (the business is controller; we act on its instruction).
 * A person is identified by phone number and/or email. Identity verification of the requester is a human step
 * recorded on the privacy request before export/erasure runs.
 */
export interface Subject {
  phoneE164: string | null;
  email: string | null;
}

export function normaliseSubject(input: { phone?: string | null; email?: string | null }, country: 'IE' | 'HR'): Subject {
  const phoneE164 = input.phone ? toE164(input.phone, country) : null;
  const email = input.email?.trim().toLowerCase() || null;
  if (!phoneE164 && !email) throw new Error('Give a valid phone number or email address for the person.');
  return { phoneE164, email };
}

async function customerIds(q: Queryable, organizationId: string, s: Subject): Promise<string[]> {
  const { rows } = await q.query(
    `select id from public.customers where organization_id = $1 and (($2::text is not null and phone_e164 = $2) or ($3::text is not null and lower(email::text) = $3))`,
    [organizationId, s.phoneE164, s.email],
  );
  return rows.map((r) => r.id);
}

/** Right of access: everything we hold about the person, in one portable JSON document. */
export async function exportSubjectData(db: Db, organizationId: string, s: Subject): Promise<Record<string, unknown>> {
  const ids = await customerIds(db, organizationId, s);
  const q = (sql: string, p: unknown[]) => db.query(sql, p).then((r) => r.rows);
  return {
    generated_at: new Date().toISOString(),
    subject: s,
    customer_records: await q(`select full_name, phone_e164, email, preferred_language, sms_opt_in, sms_opt_in_at, notes, created_at, last_contact_at from public.customers where id = any($1)`, [ids]),
    appointments: await q(
      `select a.starts_at, a.ends_at, a.status, a.source, s.names as service, st.display_name as staff, a.created_at
         from public.appointments a join public.services s on s.id = a.service_id join public.staff_members st on st.id = a.staff_id
        where a.organization_id = $1 and a.customer_id = any($2) order by a.starts_at`,
      [organizationId, ids],
    ),
    calls: await q(
      `select c.started_at, c.duration_sec, c.outcome, c.summary, t.segments as transcript
         from public.calls c left join public.call_transcripts t on t.call_id = c.id
        where c.organization_id = $1 and (($2::text is not null and c.from_e164 = $2) or c.customer_id = any($3)) order by c.started_at`,
      [organizationId, s.phoneE164, ids],
    ),
    messages: await q(
      `select kind, caller_name, callback_phone_e164, summary, fields, created_at from public.enquiries
        where organization_id = $1 and ($2::text is not null and callback_phone_e164 = $2) order by created_at`,
      [organizationId, s.phoneE164],
    ),
    notifications_sent: await q(
      `select channel, template, status, sent_at from public.notifications where organization_id = $1 and recipient in ($2, $3) order by created_at`,
      [organizationId, s.phoneE164 ?? '', s.email ?? ''],
    ),
  };
}

/**
 * Right to erasure. Removes personal data; keeps anonymous operational records (that a booking slot was used,
 * call counts for billing) which contain nothing that identifies the person.
 */
export async function eraseSubjectData(db: Db, organizationId: string, s: Subject, actorUserId: string | null): Promise<Record<string, number>> {
  return db.tx(async (q) => {
    const ids = await customerIds(q, organizationId, s);
    const count = async (sql: string, p: unknown[]) => (await q.query(sql, p)).rowCount ?? 0;
    const callIds = (
      await q.query(`select id from public.calls where organization_id = $1 and (($2::text is not null and from_e164 = $2) or customer_id = any($3))`, [organizationId, s.phoneE164, ids])
    ).rows.map((r) => r.id);
    const result = {
      transcripts: await count(`delete from public.call_transcripts where call_id = any($1)`, [callIds]),
      recordings: await count(`delete from public.call_recordings where call_id = any($1)`, [callIds]),
      calls_anonymised: await count(`update public.calls set from_e164 = null, summary = null, customer_id = null where id = any($1)`, [callIds]),
      messages: await count(`delete from public.enquiries where organization_id = $1 and $2::text is not null and callback_phone_e164 = $2`, [organizationId, s.phoneE164]),
      notifications: await count(`delete from public.notifications where organization_id = $1 and recipient in ($2, $3)`, [organizationId, s.phoneE164 ?? '', s.email ?? '']),
      appointments_unlinked: await count(`update public.appointments set notes = null where organization_id = $1 and customer_id = any($2)`, [organizationId, ids]),
      customers: await count(`delete from public.customers where id = any($1)`, [ids]), // appointments.customer_id → null via FK
    };
    // Audit rows for customers are kept but stripped of personal fields.
    await q.query(
      `update public.audit_logs set old_data = old_data - 'full_name' - 'phone_e164' - 'email' - 'notes', new_data = new_data - 'full_name' - 'phone_e164' - 'email' - 'notes'
        where organization_id = $1 and target_table in ('customers', 'appointments') and (target_id = any($2) or old_data ->> 'customer_id' = any($2) or new_data ->> 'customer_id' = any($2))`,
      [organizationId, ids],
    );
    await q.query(
      `insert into public.privacy_requests (organization_id, kind, subject_phone_e164, subject_email, status, completed_at, notes)
       values ($1, 'erasure', $2, $3, 'completed', now(), $4)`,
      [organizationId, s.phoneE164 ? `${s.phoneE164.slice(0, 4)}***${s.phoneE164.slice(-2)}` : null, s.email ? `${s.email[0]}***@${s.email.split('@')[1]}` : null, JSON.stringify(result)],
    );
    return result;
  }, { actorUserId });
}
