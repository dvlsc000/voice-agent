'use client';
import { useActionState } from 'react';

type State = { ok?: string; error?: string };

/** A form bound to a server action, showing the result inline next to the submit button. */
export function ActionForm({ action, submit, pendingLabel, children, className }: { action: (s: State, f: FormData) => Promise<State>; submit: string; pendingLabel: string; children?: React.ReactNode; className?: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className={className ?? 'grid gap-3'}>
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-primary" disabled={pending}>{pending ? pendingLabel : submit}</button>
        {state.ok ? <span role="status" className="text-lamp-green">{state.ok}</span> : null}
        {state.error ? <span role="alert" className="text-lamp-red">{state.error}</span> : null}
      </div>
    </form>
  );
}
