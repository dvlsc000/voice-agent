import { DateTime } from 'luxon';
import {
  deriveBookingReference,
  renderBookingMessage,
  renderDailySummary,
  renderEnquiryMessage,
  type Language,
  type NotificationTemplate,
  type RenderedMessage,
} from '@vp/core';
import type { CalendarBinding } from '../booking-service';
import type { Db, Queryable } from '../db';
import { PermanentSendError, type EmailSender, type SmsSender } from '../messaging';
import { NonRetryableJobError, type Job, type JobHandler } from './runner';

export interface WorkerDeps {
  db: Db;
  email: EmailSender;
  sms: SmsSender | null; // null = SMS not configured on this deployment
  siteUrl: string;
  resolveCalendar?: (organizationId: string, staffId: string) => Promise<CalendarBinding | null>;
  /** Bookings stuck in `committing` longer than this are treated as outcome-unknown. */
  staleCommitSeconds?: number;
}

interface AppointmentContext {
  id: string;
  organization_id: string;
  status: string;
  starts_at: Date;
  staff_id: string;
  idempotency_key: string;
  org_name: string;
  timezone: string;
  language: Language;
  contact_email: string | null;
  reference_salt: string;
  slug: string;
  service_names: Record<string, string>;
  staff_name: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  customer_language: Language | null;
  address_line: string | null;
  sms_enabled: boolean;
}

async function loadAppointment(q: Queryable, id: string): Promise<AppointmentContext> {
  const { rows } = await q.query<AppointmentContext>(
    `select a.id, a.organization_id, a.status, a.starts_at, a.staff_id, a.idempotency_key,
            o.name as org_name, o.timezone, o.primary_language as language, o.contact_email, o.reference_salt, o.slug,
            s.names as service_names, st.display_name as staff_name,
            c.full_name as customer_name, c.phone_e164 as customer_phone, c.email as customer_email, c.preferred_language as customer_language,
            l.address_line,
            coalesce((select v.settings -> 'enabledCapabilities' ? 'sms_confirmations'
                        from public.agents ag join public.agent_versions v on v.id = ag.active_version_id
                       where ag.organization_id = a.organization_id limit 1), false) as sms_enabled
       from public.appointments a
       join public.organizations o on o.id = a.organization_id
       join public.services s on s.id = a.service_id
       join public.staff_members st on st.id = a.staff_id
       left join public.customers c on c.id = a.customer_id
       left join public.locations l on l.organization_id = a.organization_id and l.is_primary
      where a.id = $1`,
    [id],
  );
  if (!rows[0]) throw new NonRetryableJobError(`Appointment ${id} not found`);
  return rows[0];
}

/** Records a notification (deduplicated per org) and schedules its delivery. Returns false if it already existed. */
export async function enqueueNotification(
  q: Queryable,
  n: { organizationId: string; channel: 'email' | 'sms'; template: NotificationTemplate; language: Language; recipient: string; dedupeKey: string; message: RenderedMessage; sendAfter?: Date },
): Promise<boolean> {
  const { rows } = await q.query(
    `insert into public.notifications (organization_id, channel, template, language, recipient, dedupe_key, payload, send_after)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (organization_id, dedupe_key) do nothing returning id`,
    [n.organizationId, n.channel, n.template, n.language, n.recipient, n.dedupeKey, JSON.stringify(n.message), n.sendAfter ?? new Date()],
  );
  if (!rows[0]) return false;
  await q.query(`insert into public.jobs (kind, organization_id, payload, run_at, dedupe_key) values ('deliver_notification', $1, $2, $3, $4) on conflict (dedupe_key) do nothing`, [
    n.organizationId,
    JSON.stringify({ notificationId: rows[0].id }),
    n.sendAfter ?? new Date(),
    `deliver:${rows[0].id}`,
  ]);
  return true;
}

function bookingData(a: AppointmentContext, lang: Language) {
  return {
    businessName: a.org_name,
    serviceName: a.service_names[lang] ?? a.service_names.en ?? a.service_names.hr ?? '',
    staffName: a.staff_name,
    start: new Date(a.starts_at).toISOString(),
    timezone: a.timezone,
    reference: deriveBookingReference(a.reference_salt, a.id),
    customerName: a.customer_name ?? undefined,
    customerPhone: a.customer_phone,
    addressLine: a.address_line,
  };
}

async function notifyCustomer(q: Queryable, a: AppointmentContext, template: NotificationTemplate, key: string, sendAfter?: Date): Promise<void> {
  const lang = a.customer_language ?? a.language;
  const msg = renderBookingMessage(template, lang, bookingData(a, lang));
  if (a.customer_email) {
    await enqueueNotification(q, { organizationId: a.organization_id, channel: 'email', template, language: lang, recipient: a.customer_email, dedupeKey: `${key}:email`, message: msg, sendAfter });
  }
  if (a.sms_enabled && a.customer_phone) {
    await enqueueNotification(q, { organizationId: a.organization_id, channel: 'sms', template, language: lang, recipient: a.customer_phone, dedupeKey: `${key}:sms`, message: msg, sendAfter });
  }
}

async function notifyStaff(q: Queryable, a: AppointmentContext, template: NotificationTemplate, key: string): Promise<void> {
  if (!a.contact_email) return;
  const msg = renderBookingMessage(template, a.language, bookingData(a, a.language));
  await enqueueNotification(q, { organizationId: a.organization_id, channel: 'email', template, language: a.language, recipient: a.contact_email, dedupeKey: key, message: msg });
}

export function createHandlers(deps: WorkerDeps): Record<string, JobHandler> {
  const { db } = deps;
  const staleSec = deps.staleCommitSeconds ?? 120;
  const id = (job: Job, k: string) => {
    const v = job.payload[k];
    if (typeof v !== 'string') throw new NonRetryableJobError(`Job ${job.id} missing ${k}`);
    return v;
  };

  return {
    async send_booking_confirmation(job) {
      const a = await loadAppointment(db, id(job, 'appointmentId'));
      if (a.status !== 'confirmed') return; // never confirm something that isn't confirmed
      await notifyCustomer(db, a, 'booking_confirmed_customer', `booking_confirmed:${a.id}`);
      await notifyStaff(db, a, 'booking_created_staff', `booking_created_staff:${a.id}`);
    },

    async send_cancellation_notice(job) {
      const a = await loadAppointment(db, id(job, 'appointmentId'));
      if (a.status !== 'cancelled') return;
      await notifyCustomer(db, a, 'booking_cancelled_customer', `booking_cancelled:${a.id}`);
      await notifyStaff(db, a, 'booking_cancelled_staff', `booking_cancelled_staff:${a.id}`);
    },

    async notify_staff_enquiry(job) {
      const { rows } = await db.query(
        `select e.*, o.name as org_name, o.contact_email, o.primary_language, o.slug from public.enquiries e
           join public.organizations o on o.id = e.organization_id where e.id = $1`,
        [id(job, 'enquiryId')],
      );
      const e = rows[0];
      if (!e) throw new NonRetryableJobError('Enquiry not found');
      if (!e.contact_email) return;
      const msg = renderEnquiryMessage(e.primary_language, {
        businessName: e.org_name,
        kind: e.kind,
        urgent: e.urgency === 'urgent',
        callerName: e.caller_name,
        callbackPhone: e.callback_phone_e164,
        summary: e.summary,
        fields: e.fields ?? {}, // sensitive_fields are deliberately never included
        dashboardUrl: `${deps.siteUrl}/app/${e.slug}/messages`,
      });
      await enqueueNotification(db, { organizationId: e.organization_id, channel: 'email', template: 'enquiry_staff', language: e.primary_language, recipient: e.contact_email, dedupeKey: `enquiry:${e.id}`, message: msg });
    },

    async deliver_notification(job) {
      const nid = id(job, 'notificationId');
      const { rows } = await db.query(
        `update public.notifications set status = 'sending', attempts = attempts + 1 where id = $1 and status in ('queued', 'failed') returning *`,
        [nid],
      );
      const n = rows[0];
      if (!n) return; // already sent or suppressed
      try {
        const msg = n.payload as RenderedMessage;
        let providerId: string;
        if (n.channel === 'email') {
          providerId = (await deps.email.send({ to: n.recipient, subject: msg.subject, text: msg.text })).providerMessageId;
        } else {
          if (!deps.sms) {
            await db.query(`update public.notifications set status = 'suppressed', error = 'SMS not configured' where id = $1`, [nid]);
            return;
          }
          providerId = (await deps.sms.send({ to: n.recipient, body: msg.text })).providerMessageId;
        }
        await db.query(`update public.notifications set status = 'sent', provider_message_id = $2, sent_at = now(), error = null where id = $1`, [nid, providerId]);
      } catch (e) {
        await db.query(`update public.notifications set status = 'failed', error = left($2, 1000) where id = $1`, [nid, (e as Error).message]);
        if (e instanceof PermanentSendError) throw new NonRetryableJobError((e as Error).message);
        throw e;
      }
    },

    async sweep_bookings() {
      await db.query(`select private.expire_stale_holds(null)`);
      // A process that died between "committing" and the calendar's answer leaves an outcome we can't know.
      const { rows } = await db.query(
        `update public.appointments set status = 'needs_reconciliation'
          where status = 'committing' and updated_at < now() - make_interval(secs => $1) returning id, organization_id`,
        [staleSec],
      );
      for (const r of rows) {
        await db.query(`insert into public.jobs (kind, organization_id, payload, dedupe_key) values ('reconcile_booking', $1, $2, $3) on conflict (dedupe_key) do nothing`, [
          r.organization_id,
          JSON.stringify({ appointmentId: r.id }),
          `reconcile:${r.id}`,
        ]);
      }
    },

    async reconcile_booking(job) {
      const a = await loadAppointment(db, id(job, 'appointmentId'));
      if (a.status !== 'needs_reconciliation') return;
      const cal = deps.resolveCalendar ? await deps.resolveCalendar(a.organization_id, a.staff_id) : null;
      if (!cal) {
        // Built-in calendar: the slot is safely held in our database, but the caller was never told "confirmed".
        // A person decides — we never silently confirm or drop a booking.
        await notifyStaff(db, a, 'booking_needs_check_staff', `needs_check:${a.id}`);
        return;
      }
      const found = await cal.adapter.findByIdempotencyKey({ calendarId: cal.calendarId, idempotencyKey: a.idempotency_key, around: new Date(a.starts_at).toISOString() });
      if (found) {
        await db.query(`update public.appointments set status = 'confirmed', external_calendar_event_id = $2 where id = $1`, [a.id, found.externalId]);
        await notifyCustomer(db, { ...a, status: 'confirmed' }, 'booking_confirmed_customer', `booking_confirmed:${a.id}`);
        await notifyStaff(db, a, 'booking_created_staff', `booking_created_staff:${a.id}`);
      } else {
        await db.query(`update public.appointments set status = 'failed' where id = $1`, [a.id]);
        await notifyStaff(db, a, 'booking_needs_check_staff', `needs_check:${a.id}`);
      }
    },

    async apply_retention() {
      await db.query(`select private.apply_retention()`);
    },

    async rollup_usage() {
      await db.query(
        `insert into public.usage_monthly (organization_id, month, calls, call_seconds, bookings, failed_bookings, transfers, cost_micros_usd, refreshed_at)
         select o.id, date_trunc('month', now())::date,
                (select count(*) from public.calls c where c.organization_id = o.id and c.started_at >= date_trunc('month', now())),
                (select coalesce(sum(duration_sec), 0) from public.calls c where c.organization_id = o.id and c.started_at >= date_trunc('month', now())),
                (select count(*) from public.appointments a where a.organization_id = o.id and a.source = 'voice' and a.created_at >= date_trunc('month', now())
                   and a.status in ('confirmed', 'completed', 'no_show', 'cancelled')),
                (select count(*) from public.appointments a where a.organization_id = o.id and a.source = 'voice' and a.created_at >= date_trunc('month', now())
                   and a.status in ('failed', 'needs_reconciliation')),
                (select count(*) from public.calls c where c.organization_id = o.id and c.outcome = 'transferred' and c.started_at >= date_trunc('month', now())),
                (select coalesce(sum(amount_micros), 0) from public.provider_cost_events p where p.organization_id = o.id and p.occurred_at >= date_trunc('month', now())),
                now()
           from public.organizations o where o.status <> 'closed'
         on conflict (organization_id, month) do update set
           calls = excluded.calls, call_seconds = excluded.call_seconds, bookings = excluded.bookings,
           failed_bookings = excluded.failed_bookings, transfers = excluded.transfers,
           cost_micros_usd = excluded.cost_micros_usd, refreshed_at = now()`,
      );
    },

    async queue_reminders() {
      // Reminders ~24h ahead, once per appointment. Only for confirmed bookings.
      const { rows } = await db.query(
        `select id from public.appointments where status = 'confirmed' and starts_at between now() + interval '23 hours' and now() + interval '25 hours'`,
      );
      for (const r of rows) {
        const a = await loadAppointment(db, r.id);
        await notifyCustomer(db, a, 'appointment_reminder_customer', `reminder:${a.id}`);
      }
    },

    async queue_daily_summaries() {
      const { rows } = await db.query(
        `select o.id, o.name, o.slug, o.timezone, o.primary_language, o.contact_email from public.organizations o
          where o.status in ('active', 'trial') and o.contact_email is not null`,
      );
      for (const o of rows) {
        const day = DateTime.now().setZone(o.timezone).minus({ days: 1 });
        const from = day.startOf('day').toUTC().toISO();
        const to = day.endOf('day').toUTC().toISO();
        const stats = (
          await db.query(
            `select (select count(*) from public.calls where organization_id = $1 and started_at between $2 and $3)::int as calls,
                    (select count(*) from public.appointments where organization_id = $1 and source = 'voice' and status = 'confirmed' and created_at between $2 and $3)::int as bookings,
                    (select count(*) from public.enquiries where organization_id = $1 and status = 'new')::int as open`,
            [o.id, from, to],
          )
        ).rows[0];
        if (stats.calls === 0 && stats.open === 0) continue; // don't email about nothing
        const msg = renderDailySummary(o.primary_language, {
          businessName: o.name,
          date: day.setLocale(o.primary_language === 'hr' ? 'hr' : 'en-IE').toFormat('cccc d LLLL'),
          calls: stats.calls,
          bookings: stats.bookings,
          openMessages: stats.open,
          dashboardUrl: `${deps.siteUrl}/app/${o.slug}`,
        });
        await enqueueNotification(db, {
          organizationId: o.id, channel: 'email', template: 'daily_summary_staff', language: o.primary_language,
          recipient: o.contact_email, dedupeKey: `daily:${day.toISODate()}`, message: msg,
        });
      }
    },
  };
}
