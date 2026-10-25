'use client';
import { useActionState } from 'react';
import type { ActionState } from './actions';

const CAP_LABEL: Record<string, string> = {
  reception: 'Answer questions (hours, prices, location)',
  booking: 'Book appointments',
  rescheduling: 'Move existing bookings',
  cancellation: 'Cancel bookings',
  lead_intake: 'Take new-client enquiries',
  messages: 'Take messages and callback requests',
  human_handoff: 'Transfer calls to staff',
  sms_confirmations: 'Text booking confirmations',
};

export function SettingsForm({
  action,
  allowed,
  current,
}: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  allowed: string[];
  current: { agentName: string; enabledCapabilities: string[]; customInstructions: string; maxCallDurationSec: number; transcriptsEnabled: boolean; voiceId: string };
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="sheet grid gap-4 p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="field"><span>Assistant’s name (said in the greeting)</span><input className="input" name="agentName" defaultValue={current.agentName} required maxLength={40} /></label>
        <label className="field"><span>Voice ID (leave empty for the default voice)</span><input className="input" name="voiceId" defaultValue={current.voiceId === 'unassigned' ? '' : current.voiceId} /></label>
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-[0.85rem] font-semibold text-ink-soft">What the assistant can do</legend>
        {allowed.map((c) => (
          <label key={c} className="flex items-center gap-2">
            <input type="checkbox" name="capabilities" value={c} defaultChecked={current.enabledCapabilities.includes(c)} className="h-4 w-4 accent-action" />
            {CAP_LABEL[c] ?? c}
          </label>
        ))}
      </fieldset>
      <label className="field">
        <span>Business preferences (plain language; cannot override safety rules)</span>
        <textarea className="input min-h-[90px]" name="customInstructions" maxLength={2000} defaultValue={current.customInstructions} placeholder="e.g. Mention free parking behind the shop. Walk-ins welcome before noon." />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="field"><span>Longest call (seconds)</span><input className="input tnum" type="number" name="maxCallDurationSec" min={60} max={3600} defaultValue={current.maxCallDurationSec} /></label>
        <label className="flex items-center gap-2 self-end pb-2"><input type="checkbox" name="transcriptsEnabled" defaultChecked={current.transcriptsEnabled} className="h-4 w-4 accent-action" />Keep call transcripts</label>
      </div>
      <p className="text-[0.85rem] text-ink-faint">Call recording stays off. Turning it on needs a recorded legal decision for this client.</p>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-primary" disabled={pending}>{pending ? 'Saving…' : 'Save as new draft'}</button>
        {state.ok ? <span role="status" className="text-lamp-green">{state.ok}</span> : null}
        {state.error ? <span role="alert" className="text-lamp-red">{state.error}</span> : null}
      </div>
    </form>
  );
}
