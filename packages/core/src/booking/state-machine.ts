/**
 * Booking lifecycle. Mirrors the `booking_status` enum in the database.
 *
 *   requested → validating → holding → committing → confirmed
 *                   ↓            ↓          ↓    ↘ needs_reconciliation → confirmed | failed
 *                 failed     expired     failed
 *
 * `needs_reconciliation` exists because an external calendar can time out *after* accepting a write.
 * We must never tell a caller "confirmed" from that state, and must never silently retry a create
 * (duplicate risk). A background job reconciles by idempotency key / external lookup.
 */
export const BOOKING_STATES = [
  'requested',
  'validating',
  'holding',
  'committing',
  'confirmed',
  'needs_reconciliation',
  'failed',
  'expired',
  'cancelled',
  'completed',
  'no_show',
] as const;
export type BookingState = (typeof BOOKING_STATES)[number];

export type BookingEvent =
  | 'validate'
  | 'validation_passed'
  | 'validation_failed'
  | 'commit'
  | 'commit_succeeded'
  | 'commit_rejected'
  | 'commit_outcome_unknown'
  | 'hold_expired'
  | 'reconciled_found'
  | 'reconciled_missing'
  | 'cancel'
  | 'mark_completed'
  | 'mark_no_show';

const TRANSITIONS: Record<BookingState, Partial<Record<BookingEvent, BookingState>>> = {
  requested: { validate: 'validating', cancel: 'cancelled' },
  validating: { validation_passed: 'holding', validation_failed: 'failed' },
  holding: { commit: 'committing', hold_expired: 'expired', cancel: 'cancelled' },
  committing: {
    commit_succeeded: 'confirmed',
    commit_rejected: 'failed',
    commit_outcome_unknown: 'needs_reconciliation',
  },
  needs_reconciliation: { reconciled_found: 'confirmed', reconciled_missing: 'failed' },
  confirmed: { cancel: 'cancelled', mark_completed: 'completed', mark_no_show: 'no_show' },
  failed: {},
  expired: {},
  cancelled: {},
  completed: {},
  no_show: {},
};

export class InvalidBookingTransition extends Error {
  constructor(
    readonly from: BookingState,
    readonly event: BookingEvent,
  ) {
    super(`Invalid booking transition: ${from} --${event}-->`);
    this.name = 'InvalidBookingTransition';
  }
}

export function nextBookingState(from: BookingState, event: BookingEvent): BookingState {
  const to = TRANSITIONS[from][event];
  if (!to) throw new InvalidBookingTransition(from, event);
  return to;
}

export function isTerminal(state: BookingState): boolean {
  return Object.keys(TRANSITIONS[state]).length === 0;
}

/** States that occupy the staff member's time and must block availability. */
export function blocksAvailability(state: BookingState): boolean {
  return state === 'holding' || state === 'committing' || state === 'confirmed' || state === 'needs_reconciliation';
}

/** The only state from which the agent may tell a caller their booking is confirmed. */
export function mayAnnounceConfirmed(state: BookingState): boolean {
  return state === 'confirmed';
}

/** Caller-facing message key for each outcome, so the LLM never improvises booking status. */
export function callerOutcome(state: BookingState): 'confirmed' | 'pending_check' | 'not_booked' | 'in_progress' {
  switch (state) {
    case 'confirmed':
      return 'confirmed';
    case 'needs_reconciliation':
      return 'pending_check';
    case 'failed':
    case 'expired':
    case 'cancelled':
      return 'not_booked';
    default:
      return 'in_progress';
  }
}
