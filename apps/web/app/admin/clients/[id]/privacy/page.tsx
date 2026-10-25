import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DateTime } from 'luxon';
import { ActionForm } from '@/components/action-form';
import { Empty, PageHeader } from '@/components/page-header';
import { requirePlatformStaff } from '@/lib/auth';
import { serverDb } from '@/lib/db';
import { erase } from './actions';

export const metadata = { title: 'Privacy requests' };
export const dynamic = 'force-dynamic';

export default async function PrivacyPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePlatformStaff();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = serverDb();
  const org = (await db.query(`select name from public.organizations where id = $1`, [id])).rows[0];
  if (!org) notFound();
  const reqs = (await db.query(`select kind, status, subject_phone_e164, subject_email, received_at, completed_at from public.privacy_requests where organization_id = $1 order by received_at desc limit 50`, [id])).rows;
  return (
    <>
      <p className="mb-2"><Link href={`/admin/clients/${id}`} className="text-action-ink hover:underline">{org.name}</Link></p>
      <PageHeader title="Privacy requests" detail="When a caller asks this business for their data, or to be forgotten. The business is the controller: act on its written instruction, after it has verified the person. Answer within one month." />
      <section aria-labelledby="h-exp" className="mb-8">
        <h2 id="h-exp" className="mb-2">Give a person their data</h2>
        <form method="get" action={`/admin/clients/${id}/privacy/export`} className="sheet grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="field"><span>Phone number</span><input className="input tnum" name="phone" /></label>
          <label className="field"><span>or email</span><input className="input" name="email" type="email" /></label>
          <button className="btn btn-primary">Download data</button>
        </form>
      </section>
      <section aria-labelledby="h-erase" className="mb-8">
        <h2 id="h-erase" className="mb-2">Erase a person’s data</h2>
        <div className="sheet p-4">
          <ActionForm action={erase.bind(null, id)} submit="Erase permanently" pendingLabel="Erasing…">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="field"><span>Phone number</span><input className="input tnum" name="phone" /></label>
              <label className="field"><span>or email</span><input className="input" name="email" type="email" /></label>
            </div>
            <p className="text-ink-soft">Removes their customer record, transcripts, recordings and messages, and anonymises their calls. Booking times stay (without their name) so the diary still adds up.</p>
            <label className="flex items-center gap-2"><input type="checkbox" name="verified" className="accent-action" />The business has verified this person’s identity and asked us in writing to erase</label>
            <label className="field sm:max-w-[16rem]"><span>Type ERASE to confirm</span><input className="input" name="confirm" autoComplete="off" /></label>
          </ActionForm>
        </div>
      </section>
      <section aria-labelledby="h-log">
        <h2 id="h-log" className="mb-2">History</h2>
        <div className="sheet">
          {!reqs.length ? <Empty title="No privacy requests yet." /> : (
            <table className="table"><thead><tr><th>Received</th><th>Type</th><th>Person</th><th>Status</th></tr></thead>
              <tbody>{reqs.map((r, i) => <tr key={i}><td className="tnum">{DateTime.fromJSDate(r.received_at).toFormat('d LLL yyyy')}</td><td>{r.kind}</td><td className="tnum">{r.subject_phone_e164 ?? r.subject_email}</td><td>{r.status}</td></tr>)}</tbody>
            </table>
          )}
        </div>
      </section>
    </>
  );
}
