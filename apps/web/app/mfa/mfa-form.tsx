'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/browser';

type Phase = { kind: 'loading' } | { kind: 'enroll'; factorId: string; qr: string; secret: string } | { kind: 'verify'; factorId: string } | { kind: 'error'; message: string };

export function MfaForm() {
  const sb = supabaseBrowser();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await sb.auth.mfa.listFactors();
      if (error) return setPhase({ kind: 'error', message: error.message });
      const verified = data.totp.find((f) => f.status === 'verified');
      if (verified) return setPhase({ kind: 'verify', factorId: verified.id });
      const enrolled = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator' });
      if (enrolled.error) return setPhase({ kind: 'error', message: enrolled.error.message });
      setPhase({ kind: 'enroll', factorId: enrolled.data.id, qr: enrolled.data.totp.qr_code, secret: enrolled.data.totp.secret });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (phase.kind !== 'enroll' && phase.kind !== 'verify') return;
    setError(null);
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: phase.factorId, code: code.trim() });
    if (error) return setError('That code didn’t match. Codes change every 30 seconds — try the current one.');
    router.replace('/admin');
    router.refresh();
  }

  if (phase.kind === 'loading') return <p className="mt-6 text-ink-soft">Checking your account…</p>;
  if (phase.kind === 'error') return <p role="alert" className="mt-6 text-lamp-red">{phase.message}</p>;
  return (
    <form onSubmit={submit} className="mt-6 grid gap-4">
      {phase.kind === 'enroll' ? (
        <div className="sheet grid gap-3 p-4">
          <p>Scan this with your authenticator app, then enter the 6-digit code it shows.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={phase.qr} alt="QR code for your authenticator app" className="h-44 w-44" />
          <p className="text-[0.85rem] text-ink-soft">
            Can’t scan? Enter this key: <code className="break-all">{phase.secret}</code>
          </p>
        </div>
      ) : null}
      <label className="field">
        <span>6-digit code</span>
        <input className="input tnum" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} required />
      </label>
      {error ? <p role="alert" className="text-lamp-red">{error}</p> : null}
      <button className="btn btn-primary justify-center">Verify</button>
    </form>
  );
}
