'use client';
import { useActionState } from 'react';
import { sendSignInLink, type LoginState } from './actions';

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(sendSignInLink, { status: 'idle' });
  if (state.status === 'sent') {
    return (
      <p role="status" className="sheet mt-6 p-4">
        If that address has an account, a sign-in link is on its way. Check your inbox and spam folder.
      </p>
    );
  }
  return (
    <form action={action} className="mt-6 grid gap-4">
      <label className="field">
        <span>Email</span>
        <input className="input" type="email" name="email" autoComplete="email" required />
      </label>
      {state.status === 'error' ? <p role="alert" className="text-lamp-red">{state.message}</p> : null}
      <button className="btn btn-primary justify-center" disabled={pending}>
        {pending ? 'Sending link…' : 'Email me a sign-in link'}
      </button>
    </form>
  );
}
