import { randomUUID } from 'node:crypto';
import {
  authorizeToolCall,
  denialGuidance,
  formatSlotForSpeech,
  slotKey,
  type CallContext,
  type Language,
} from '@vp/core';
import type { BookingService } from './booking-service';
import { renderBusinessFacts } from './business-facts';
import type { Db } from './db';

/** Mutable per-call session held by the voice gateway. Persisted as call_events for audit/replay. */
export interface CallSession {
  ctx: CallContext & { verifiedBookingIds: Set<string>; offeredSlots: Set<string> };
  callerIdE164: string | null;
  timezone: string;
  language: Language;
  verificationAttempts: number;
}

export interface ToolResult {
  ok: boolean;
  /** Structured facts for the model. Never contains anything the caller should not hear. */
  data?: Record<string, unknown>;
  /** Instruction for the model on what to do/say next. */
  guidance?: string;
  /** Side effect for the gateway to perform (transfer, hang up). */
  action?: { type: 'transfer'; target: string } | { type: 'hangup' };
}

const spokenDigits = (ref: string) => ref.split('').join(' ');
const maskPhone = (v: unknown) => (typeof v === 'string' && v.length > 4 ? `***${v.slice(-3)}` : v);

function redactArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (/phone/.test(k)) out[k] = maskPhone(v);
    else if (/name|message|summary|fields|reference/.test(k)) out[k] = '[redacted]';
    else out[k] = v;
  }
  return out;
}

export class ToolExecutor {
  constructor(private readonly deps: { db: Db; booking: BookingService }) {}

  private async log(session: CallSession, type: string, payload: Record<string, unknown>): Promise<void> {
    await this.deps.db.query(`insert into public.call_events (organization_id, call_id, type, payload) values ($1, $2, $3, $4)`, [
      session.ctx.organizationId,
      session.ctx.callId,
      type,
      JSON.stringify(payload),
    ]);
  }

  async execute(session: CallSession, name: string, rawArgs: unknown, toolCallId: string = randomUUID()): Promise<ToolResult> {
    const auth = authorizeToolCall(session.ctx, name, rawArgs);
    session.ctx.toolCallsSoFar += 1;
    if (!auth.allowed) {
      await this.log(session, 'tool.denied', { toolCallId, name, reason: auth.reason });
      return { ok: false, guidance: denialGuidance(auth.reason) };
    }
    const args = auth.args as Record<string, any>;
    await this.log(session, 'tool.requested', { toolCallId, name, args: redactArgs(args) });
    const org = session.ctx.organizationId;
    let result: ToolResult;

    try {
      switch (auth.tool) {
        case 'get_business_info': {
          result = { ok: true, data: { facts: await renderBusinessFacts(this.deps.db, org, session.language) } };
          break;
        }
        case 'check_availability': {
          const r = await this.deps.booking.checkAvailability(org, { serviceId: args.service_id, staffId: args.staff_id, date: args.date, dayPart: args.day_part });
          if (!r.ok) {
            result = { ok: false, guidance: r.reason === 'unknown_service' ? 'That service cannot be booked by phone. Offer to take a message.' : 'Ask the caller for a valid date.' };
            break;
          }
          for (const s of r.options) session.ctx.offeredSlots.add(slotKey(s.staffId, s.start));
          result = {
            ok: true,
            data: {
              options: r.options.map((s) => ({ staff_id: s.staffId, start: s.start, spoken: formatSlotForSpeech(s.start, session.timezone, session.language) })),
              more_available: r.totalAvailable > r.options.length,
            },
            guidance: r.options.length ? 'Offer these times. Book only one the caller explicitly accepts.' : 'Nothing free then. Ask about another day or time of day.',
          };
          break;
        }
        case 'book_appointment': {
          session.ctx.consequentialCallsSoFar += 1;
          const r = await this.deps.booking.book(org, {
            serviceId: args.service_id,
            staffId: args.staff_id,
            start: args.start,
            customerName: args.customer_name,
            customerPhone: args.customer_phone,
            source: 'voice',
            idempotencyKey: `${session.ctx.callId}:book:${args.staff_id}:${new Date(args.start).toISOString()}`,
            callId: session.ctx.callId,
          });
          result = this.bookingResult(r, session);
          break;
        }
        case 'verify_caller_booking': {
          const r = await this.deps.booking.verifyCaller(org, {
            reference: args.reference,
            callerIdE164: session.callerIdE164,
            statedPhoneE164: args.stated_phone ?? null,
            attemptsSoFar: session.verificationAttempts,
          });
          session.verificationAttempts += 1;
          if (r.ok) {
            for (const id of r.appointmentIds) session.ctx.verifiedBookingIds.add(id);
            const { rows } = await this.deps.db.query(`select id, starts_at from public.appointments where id = any($1) order by starts_at`, [r.appointmentIds]);
            result = { ok: true, data: { bookings: rows.map((b) => ({ booking_id: b.id, spoken: formatSlotForSpeech(new Date(b.starts_at).toISOString(), session.timezone, session.language) })) } };
          } else {
            result = {
              ok: false,
              guidance:
                r.reason === 'too_many_attempts'
                  ? 'Verification failed too many times. Do not try again; offer to take a message for the team.'
                  : 'Those details do not match a booking. Ask the caller to check the reference from their confirmation, or offer to take a message.',
            };
          }
          break;
        }
        case 'reschedule_booking': {
          session.ctx.consequentialCallsSoFar += 1;
          const r = await this.deps.booking.reschedule(org, args.booking_id, {
            newStart: args.new_start,
            staffId: args.staff_id,
            idempotencyKey: `${session.ctx.callId}:reschedule:${args.booking_id}:${new Date(args.new_start).toISOString()}`,
          });
          if (r.status === 'confirmed') {
            session.ctx.verifiedBookingIds.delete(args.booking_id);
            session.ctx.verifiedBookingIds.add(r.appointmentId);
          }
          result = this.bookingResult(r, session);
          break;
        }
        case 'cancel_booking': {
          session.ctx.consequentialCallsSoFar += 1;
          const r = await this.deps.booking.cancel(org, args.booking_id, { reason: 'caller_request', enforceNotice: true });
          result =
            r.status === 'cancelled'
              ? { ok: true, data: { status: 'cancelled' }, guidance: 'Tell the caller the booking is cancelled.' }
              : r.status === 'too_late'
                ? { ok: false, guidance: 'It is too close to the appointment to cancel by phone under the business policy. Offer to take a message for the team.' }
                : { ok: false, guidance: 'The cancellation did not go through. Do NOT say it is cancelled. Offer to take a message.' };
          break;
        }
        case 'take_message':
        case 'request_callback':
        case 'capture_lead': {
          const kind = auth.tool === 'take_message' ? 'message' : auth.tool === 'request_callback' ? 'callback' : 'lead';
          const urgent = args.urgent === true || args.urgency === 'urgent' || auth.tool === 'request_callback';
          const id = randomUUID();
          await this.deps.db.query(
            `insert into public.enquiries (id, organization_id, call_id, kind, urgency, caller_name, callback_phone_e164, summary, fields, escalation_rule_id)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [id, org, session.ctx.callId, kind, urgent ? 'urgent' : 'normal', args.caller_name ?? args.fields?.customer_name ?? null,
              args.callback_phone ?? args.fields?.customer_phone ?? null, args.message ?? args.summary ?? args.reason_category ?? null,
              JSON.stringify(args.fields ?? {}), args.escalation_rule_id ?? null],
          );
          await this.deps.db.query(
            `insert into public.jobs (kind, organization_id, payload, dedupe_key) values ('notify_staff_enquiry', $1, $2, $3) on conflict (dedupe_key) do nothing`,
            [org, JSON.stringify({ enquiryId: id }), `enquiry:${id}`],
          );
          result = { ok: true, data: { saved: true, urgent }, guidance: 'Confirm the message has been passed on. Do not promise a specific callback time.' };
          break;
        }
        case 'transfer_to_human': {
          const { rows } = await this.deps.db.query(`select fallback_phone_e164 from public.organizations where id = $1`, [org]);
          const target = rows[0]?.fallback_phone_e164 as string | null;
          result = target
            ? { ok: true, action: { type: 'transfer', target }, guidance: 'Tell the caller you are putting them through.' }
            : { ok: false, guidance: 'Nobody is available to take the call right now. Offer to take a message.' };
          break;
        }
        case 'end_call': {
          result = { ok: true, action: { type: 'hangup' } };
          break;
        }
      }
    } catch (e) {
      await this.log(session, 'tool.error', { toolCallId, name, error: (e as Error).message.slice(0, 500) });
      return { ok: false, guidance: 'Something went wrong on our side. Do not say the action succeeded. Offer to take a message.' };
    }
    await this.log(session, 'tool.result', { toolCallId, name, ok: result.ok, status: (result.data as any)?.status ?? null });
    return result;
  }

  private bookingResult(r: Awaited<ReturnType<BookingService['book']>>, session: CallSession): ToolResult {
    switch (r.status) {
      case 'confirmed':
        return {
          ok: true,
          data: { status: 'confirmed', booking_id: r.appointmentId, reference_spoken: spokenDigits(r.reference), when: formatSlotForSpeech(r.start, session.timezone, session.language) },
          guidance: 'Confirm the booking, read the reference number slowly, and say it is needed to change or cancel.',
        };
      case 'pending_check':
        return { ok: false, data: { status: 'pending_check' }, guidance: 'Say the booking is being finalised and the business will confirm by message. Do NOT say it is confirmed.' };
      case 'slot_unavailable':
        return { ok: false, data: { status: 'slot_unavailable' }, guidance: 'That time was just taken. Apologise and check availability again.' };
      case 'calendar_unavailable':
        return { ok: false, data: { status: 'calendar_unavailable' }, guidance: 'The booking system is unavailable. Do NOT say it is booked. Offer to take a message so the team can book it.' };
      case 'invalid':
        return { ok: false, guidance: 'This booking cannot be made by phone. Offer to take a message.' };
    }
  }
}
