import { requireUser } from '@/lib/auth';
import { MfaForm } from './mfa-form';

export const metadata = { title: 'Two-step verification' };

export default async function MfaPage() {
  await requireUser();
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-[400px]">
        <h1>Two-step verification</h1>
        <p className="mt-2 text-ink-soft">The operator console needs a code from your authenticator app every time you sign in.</p>
        <MfaForm />
      </div>
    </main>
  );
}
