'use client';
import { useActionState } from 'react';
import type { SaveState } from './actions';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function HoursForm({ action, initial }: { action: (s: SaveState, f: FormData) => Promise<SaveState>; initial: Record<number, { opens: string; closes: string }> }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="sheet p-4">
      <fieldset className="grid gap-2">
        <legend className="sr-only">Opening hours</legend>
        {DAYS.map((name, i) => {
          const d = i + 1;
          const h = initial[d];
          return (
            <div key={d} className="grid grid-cols-[7.5rem_1fr] items-center gap-3 sm:grid-cols-[9rem_auto_auto_auto]">
              <label className="flex items-center gap-2">
                <input type="checkbox" name={`open-${d}`} defaultChecked={!!h} className="h-4 w-4 accent-action" />
                {name}
              </label>
              <div className="col-span-1 flex items-center gap-2 sm:col-span-3">
                <input aria-label={`${name} opens`} className="input tnum w-[7rem]" type="time" name={`opens-${d}`} defaultValue={h?.opens ?? '09:00'} />
                <span className="text-ink-faint">to</span>
                <input aria-label={`${name} closes`} className="input tnum w-[7rem]" type="time" name={`closes-${d}`} defaultValue={h?.closes ?? '17:00'} />
              </div>
            </div>
          );
        })}
      </fieldset>
      <div className="mt-4 flex items-center gap-3">
        <button className="btn btn-primary" disabled={pending}>{pending ? 'Saving…' : 'Save hours'}</button>
        {state.ok ? <p role="status" className="text-lamp-green">Hours saved. Your assistant uses them from the next call.</p> : null}
        {state.error ? <p role="alert" className="text-lamp-red">{state.error}</p> : null}
      </div>
    </form>
  );
}
