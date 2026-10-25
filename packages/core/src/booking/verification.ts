import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Caller verification before reading, changing or cancelling an existing booking.
 *
 * A name alone is never sufficient (spec §9.3). Caller ID can be spoofed, so it is never sufficient alone either.
 *
 *  - `reference_and_phone` (default): caller states the 6-digit booking reference AND the phone number on the
 *    booking matches either the caller ID or a number the caller states.
 *  - `sms_otp` (sensitive industries): a one-time code is sent by SMS to the phone number on file.
 *
 * Attempts are capped per call to stop enumeration of reference codes.
 */
export type VerificationMethod = 'reference_and_phone' | 'sms_otp';

export const MAX_VERIFICATION_ATTEMPTS_PER_CALL = 3;

/** 6 digits — easy to say and hear in English and Croatian; never starts with 0 to avoid dropped leading zeros. */
export function generateBookingReference(): string {
  return String(randomInt(100000, 1000000));
}

/**
 * Deterministic reference for an appointment: HMAC(tenant salt, appointment id) → 6 digits.
 * Reproducible on idempotent retries (so a replayed tool call can repeat the same reference to the caller)
 * without ever storing the plain code. Not unique per tenant — lookups always combine it with the phone number.
 */
export function deriveBookingReference(tenantSalt: string, appointmentId: string): string {
  const n = createHmac('sha256', tenantSalt).update(appointmentId).digest().readUInt32BE(0);
  return String(100000 + (n % 900000));
}

/** References are stored hashed so a database read does not reveal working codes. */
export function hashReference(reference: string, tenantSalt: string): string {
  return createHash('sha256').update(`${tenantSalt}:${normaliseSpokenDigits(reference)}`).digest('hex');
}

/** "one two three, four five six" / "1 2 3-456" / "jedan dva tri četiri pet šest" → "123456" */
export function normaliseSpokenDigits(input: string): string {
  const words: Record<string, string> = {
    zero: '0', oh: '0', o: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7',
    eight: '8', nine: '9', nula: '0', jedan: '1', jedna: '1', dva: '2', dvije: '2', tri: '3', četiri: '4',
    cetiri: '4', pet: '5', šest: '6', sest: '6', sedam: '7', osam: '8', devet: '9',
  };
  const tokens = input.toLowerCase().split(/[\s,.\-]+/).filter(Boolean);
  let out = '';
  for (const tok of tokens) {
    if (/^\d+$/.test(tok)) out += tok;
    else if (tok === 'double' || tok === 'triple') out += `{${tok}}`;
    else if (words[tok] !== undefined) {
      const d = words[tok]!;
      if (out.endsWith('{double}')) out = out.slice(0, -8) + d + d;
      else if (out.endsWith('{triple}')) out = out.slice(0, -8) + d + d + d;
      else out += d;
    }
  }
  return out.replace(/\{(double|triple)\}/g, '');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export interface VerificationInput {
  statedReference?: string;
  callerIdE164?: string | null; // may be withheld
  statedPhoneE164?: string | null;
  attemptsSoFar: number;
}

export interface BookingIdentity {
  referenceHash: string;
  customerPhoneE164: string | null;
}

export type VerificationResult =
  | { ok: true; matchedVia: 'caller_id' | 'stated_phone' }
  | { ok: false; reason: 'too_many_attempts' | 'missing_reference' | 'mismatch' };

export function verifyReferenceAndPhone(
  input: VerificationInput,
  booking: BookingIdentity,
  tenantSalt: string,
): VerificationResult {
  if (input.attemptsSoFar >= MAX_VERIFICATION_ATTEMPTS_PER_CALL) return { ok: false, reason: 'too_many_attempts' };
  if (!input.statedReference) return { ok: false, reason: 'missing_reference' };
  const refOk = safeEqual(hashReference(input.statedReference, tenantSalt), booking.referenceHash);
  // Evaluate both phone paths regardless, so timing does not leak which part failed.
  const viaCallerId = !!booking.customerPhoneE164 && input.callerIdE164 === booking.customerPhoneE164;
  const viaStated = !!booking.customerPhoneE164 && input.statedPhoneE164 === booking.customerPhoneE164;
  if (refOk && (viaCallerId || viaStated)) return { ok: true, matchedVia: viaCallerId ? 'caller_id' : 'stated_phone' };
  return { ok: false, reason: 'mismatch' };
}
