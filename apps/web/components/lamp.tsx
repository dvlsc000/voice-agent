const STYLES = {
  green: 'bg-lamp-green-wash text-lamp-green',
  amber: 'bg-lamp-amber-wash text-lamp-amber-ink',
  red: 'bg-lamp-red-wash text-lamp-red',
  off: 'bg-ground text-ink-soft',
  blue: 'bg-action-wash text-action-ink',
} as const;
const DOT = { green: 'bg-lamp-green', amber: 'bg-lamp-amber', red: 'bg-lamp-red', off: 'bg-ink-faint', blue: 'bg-action' } as const;

/** Status indicator. The text always states the status; colour only reinforces it. */
export function Lamp({ tone, children }: { tone: keyof typeof STYLES; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[0.8rem] font-medium whitespace-nowrap ${STYLES[tone]}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${DOT[tone]}`} />
      {children}
    </span>
  );
}

export function bookingTone(status: string): keyof typeof STYLES {
  if (status === 'confirmed' || status === 'completed') return 'green';
  if (status === 'needs_reconciliation' || status === 'holding' || status === 'committing') return 'amber';
  if (status === 'failed' || status === 'no_show') return 'red';
  return 'off';
}

export const BOOKING_LABEL: Record<string, string> = {
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
  needs_reconciliation: 'Check calendar',
  holding: 'Being booked',
  committing: 'Being booked',
  failed: 'Not booked',
  expired: 'Not booked',
  no_show: 'No-show',
};

export const OUTCOME_LABEL: Record<string, string> = {
  booked: 'Booked',
  rescheduled: 'Rescheduled',
  cancelled: 'Cancelled booking',
  info_given: 'Answered a question',
  message_taken: 'Took a message',
  lead_captured: 'New enquiry',
  transferred: 'Transferred to you',
  escalated: 'Urgent — needs you',
  abandoned: 'Caller hung up',
  spam: 'Spam',
  failed: 'Call failed',
  other: 'Other',
};
