import Link from 'next/link';
import { notFound } from 'next/navigation';
import { blockersFor, type ImportSuggestions } from '@vp/server';
import { ActionButton } from '@/components/action-button';
import { ActionForm } from '@/components/action-form';
import { PageHeader } from '@/components/page-header';
import { requirePlatformStaff } from '@/lib/auth';
import { serverDb } from '@/lib/db';
import { telephonyEnv } from '@/lib/env';
import { activate, applyImport, connectNumber, markSupervisedCall, runImport } from './actions';

export const metadata = { title: 'Set up client' };
export const dynamic = 'force-dynamic';

const DAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const eur = (m: number | null) => (m == null ? '—' : `€${(m / 100).toFixed(2)}`);

export default async function OnboardingPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePlatformStaff();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = serverDb();
  const org = (await db.query(`select id, name, website_url, status, country from public.organizations where id = $1`, [id])).rows[0];
  if (!org) notFound();
  const session = (await db.query(`select answers from public.onboarding_sessions where organization_id = $1`, [id])).rows[0];
  const imp = session?.answers?.website_import as ImportSuggestions | undefined;
  const numbers = (await db.query(`select e164, connection_type, status from public.phone_numbers where organization_id = $1 and status <> 'released'`, [id])).rows;
  const supervised = (await db.query(`select status from public.onboarding_tasks where organization_id = $1 and kind = 'supervised_test_call'`, [id])).rows[0]?.status;
  const blockers = await blockersFor(db, id);
  const tel = telephonyEnv();

  return (
    <>
      <p className="mb-2"><Link href={`/admin/clients/${id}`} className="text-action-ink hover:underline">{org.name}</Link></p>
      <PageHeader title="Set up and go live" detail="Work top to bottom. Anything taken from the client's website is a suggestion until you apply it, and prices stay unapproved until the owner confirms them." />

      <section aria-labelledby="h-web" className="mb-10">
        <h2 id="h-web" className="mb-2">1. Read the client’s website</h2>
        <div className="sheet grid gap-4 p-4">
          <ActionForm action={runImport.bind(null, id)} submit="Read website" pendingLabel="Reading…" className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="field"><span>Website</span><input className="input" name="url" type="url" defaultValue={org.website_url ?? ''} placeholder="https://" required /></label>
          </ActionForm>
          {imp ? (
            <ActionForm action={applyImport.bind(null, id)} submit="Apply selected" pendingLabel="Applying…">
              <p className="text-[0.85rem] text-ink-faint">Read from {imp.sourceUrl}. {imp.warnings.join(' ')}</p>
              {imp.address ? (
                <label className="flex items-start gap-2"><input type="checkbox" name="address" className="mt-1 accent-action" /><span>Address: {[imp.address.line, imp.address.city, imp.address.postcode].filter(Boolean).join(', ')}</span></label>
              ) : null}
              {imp.phone ? <label className="flex items-start gap-2"><input type="checkbox" name="phone" className="mt-1 accent-action" /><span>Business phone: {imp.phone}</span></label> : null}
              {imp.hours.length ? (
                <label className="flex items-start gap-2">
                  <input type="checkbox" name="hours" className="mt-1 accent-action" />
                  <span>Opening hours (replaces current): {imp.hours.map((h) => `${DAYS[h.weekday]} ${h.opens}–${h.closes}`).join(', ')}</span>
                </label>
              ) : null}
              {imp.services.length ? (
                <fieldset className="grid gap-1">
                  <legend className="mb-1 text-[0.85rem] font-semibold text-ink-soft">Services and prices found (durations default to 30 minutes — check them)</legend>
                  {imp.services.map((s) => (
                    <label key={s.name} className="flex items-center gap-2"><input type="checkbox" name="service" value={s.name} className="accent-action" />{s.name} <span className="tnum text-ink-soft">{s.priceIsFrom ? 'from ' : ''}{eur(s.priceMinor)}</span></label>
                  ))}
                </fieldset>
              ) : null}
              <details className="text-[0.85rem] text-ink-soft">
                <summary className="cursor-pointer">Where each suggestion came from</summary>
                <ul className="mt-1 list-disc pl-5">{imp.evidence.map((e, i) => <li key={i}>{e.field} ({e.source.replace('_', ' ')}): “{e.snippet}”</li>)}</ul>
              </details>
            </ActionForm>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="h-num" className="mb-10">
        <h2 id="h-num" className="mb-2">2. Phone number</h2>
        <div className="sheet grid gap-4 p-4">
          {numbers.length ? (
            <ul className="grid gap-1">{numbers.map((n) => <li key={n.e164} className="tnum">{n.e164} — {n.connection_type === 'forwarded' ? 'client forwards their calls here' : 'number in our Twilio account'} ({n.status})</li>)}</ul>
          ) : <p className="text-ink-soft">No number connected yet.</p>}
          <ActionForm action={connectNumber.bind(null, id)} submit="Connect number" pendingLabel="Connecting…" className="grid gap-3 sm:grid-cols-[14rem_1fr_auto] sm:items-end">
            <label className="field">
              <span>How it connects</span>
              <select className="input" name="mode" defaultValue={tel ? 'twilio_existing' : 'forwarded'}>
                <option value="twilio_existing" disabled={!tel}>Number in our Twilio account</option>
                <option value="forwarded">Our number the client forwards to</option>
              </select>
            </label>
            <label className="field"><span>Number</span><input className="input tnum" name="e164" placeholder={org.country === 'HR' ? '01 234 5678' : '091 123 456'} required /></label>
          </ActionForm>
          <p className="text-[0.85rem] text-ink-faint">Buying new numbers costs money and may need regulatory documents (Ireland: address; Croatia: court-register extract and a local address) — do it in Twilio, then connect it here.</p>
        </div>
      </section>

      <section aria-labelledby="h-test" className="mb-10">
        <h2 id="h-test" className="mb-2">3. Supervised test call</h2>
        <div className="sheet grid gap-3 p-4">
          <p className="text-ink-soft">With the client, call the number from a mobile, book something, ask a question it can’t answer, and ask for a person. Then confirm here.</p>
          {supervised === 'done' ? <p className="text-lamp-green">Done.</p> : <ActionButton action={markSupervisedCall.bind(null, id)} label="Test call went well" pendingLabel="Saving…" />}
        </div>
      </section>

      <section aria-labelledby="h-live">
        <h2 id="h-live" className="mb-2">4. Go live</h2>
        <div className="sheet grid gap-3 p-4">
          {org.status !== 'onboarding' ? <p className="text-lamp-green">This client is live.</p> : (
            <>
              {blockers.length || supervised !== 'done' ? (
                <ul className="list-disc pl-5 text-ink-soft">{[...blockers, ...(supervised !== 'done' ? ['Make a supervised test call'] : [])].map((b) => <li key={b}>{b}</li>)}</ul>
              ) : <p>Everything is ready.</p>}
              <ActionButton action={activate.bind(null, id)} label="Go live" pendingLabel="Switching on…" variant="primary" disabled={blockers.length > 0 || supervised !== 'done'} />
            </>
          )}
        </div>
      </section>
    </>
  );
}
