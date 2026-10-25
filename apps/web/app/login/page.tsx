import type { Metadata } from 'next';
import { brandName } from '@/lib/env';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-[380px]">
        <p className="text-ink-faint">{brandName()}</p>
        <h1 className="mt-1">Sign in to your phone desk</h1>
        <p className="mt-2 text-ink-soft">We’ll email you a sign-in link. It works once and expires after an hour.</p>
        <LoginForm />
      </div>
    </main>
  );
}
