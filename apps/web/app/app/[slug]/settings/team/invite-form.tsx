'use client';
import { useActionState } from 'react';
import type { State } from './actions';

export function InviteForm({ action }: { action: (s: State, f: FormData) => Promise<State> }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="sheet mb-6 grid gap-3 p-4 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
      <label className="field"><span>Email</span><input className="input" type="email" name="email" required /></label>
      <label className="field">
        <span>Role</span>
        <select className="input" name="role" defaultValue="receptionist">
          <option value="manager">Manager — can change settings</option>
          <option value="receptionist">Front desk — calls, bookings, messages</option>
          <option value="analyst">View only — no customer details</option>
        </select>
      </label>
      <button className="btn btn-primary" disabled={pending}>{pending ? 'Sending…' : 'Send invitation'}</button>
      {state.ok ? <p role="status" className="text-lamp-green sm:col-span-3">{state.ok}</p> : null}
      {state.error ? <p role="alert" className="text-lamp-red sm:col-span-3">{state.error}</p> : null}
    </form>
  );
}
