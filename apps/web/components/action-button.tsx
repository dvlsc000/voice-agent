'use client';
import { useActionState } from 'react';

type State = { ok?: string; error?: string };

/** A single-purpose button bound to a server action, with inline result text. */
export function ActionButton({
  action,
  label,
  pendingLabel,
  variant = 'quiet',
  disabled,
  hint,
}: {
  action: (s: State) => Promise<State>;
  label: string;
  pendingLabel: string;
  variant?: 'primary' | 'quiet';
  disabled?: boolean;
  hint?: string;
}) {
  const [state, formAction, pending] = useActionState<State, FormData>((s) => action(s), {});
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <button className={`btn ${variant === 'primary' ? 'btn-primary' : 'btn-quiet'}`} disabled={pending || disabled}>
        {pending ? pendingLabel : label}
      </button>
      {state.ok ? <span role="status" className="text-lamp-green">{state.ok}</span> : null}
      {state.error ? <span role="alert" className="text-lamp-red">{state.error}</span> : null}
      {!state.ok && !state.error && hint ? <span className="text-[0.85rem] text-ink-faint">{hint}</span> : null}
    </form>
  );
}
