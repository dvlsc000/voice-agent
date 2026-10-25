import { DateTime } from 'luxon';
import { Lamp } from '@/components/lamp';
import { Empty, PageHeader } from '@/components/page-header';
import { requireMembership } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { setEnquiryStatus } from './actions';

export const metadata = { title: 'Messages' };

const KIND = { message: 'Message', callback: 'Call back', lead: 'New enquiry', voicemail: 'Voicemail' } as Record<string, string>;

export default async function MessagesPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ show?: string }> }) {
  const { slug } = await params;
  const { show } = await searchParams;
  const m = await requireMembership(slug);
  if (m.role === 'analyst') {
    return <PageHeader title="Messages" detail="Messages contain callers’ personal details, so they’re not shown for read-only accounts." />;
  }
  const sb = await supabaseServer();
  const done = show === 'done';
  const { data, error } = await sb
    .from('enquiries')
    .select('id, kind, urgency, caller_name, callback_phone_e164, summary, fields, created_at, call_id')
    .eq('organization_id', m.organizationId)
    .eq('status', done ? 'done' : 'new')
    .order('urgency', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  const act = setEnquiryStatus.bind(null, slug);
  return (
    <>
      <PageHeader
        title="Messages"
        detail="Messages, callback requests and new enquiries your assistant took. Urgent ones are at the top."
        actions={
          <a className="btn btn-quiet" href={done ? `/app/${slug}/messages` : `/app/${slug}/messages?show=done`}>
            {done ? 'Show open' : 'Show handled'}
          </a>
        }
      />
      <div className="sheet">
        {!data?.length ? (
          <Empty title={done ? 'Nothing handled yet.' : 'You’re all caught up.'} />
        ) : (
          <ul className="divide-y divide-rule">
            {data.map((e: any) => (
              <li key={e.id} className="grid gap-2 px-4 py-4 sm:grid-cols-[1fr_auto] sm:items-start">
                <div className="max-w-[70ch]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{e.caller_name ?? 'Unknown caller'}</span>
                    {e.urgency === 'urgent' ? <Lamp tone="amber">Urgent</Lamp> : null}
                    <span className="text-[0.85rem] text-ink-faint">
                      {KIND[e.kind]} · {DateTime.fromISO(e.created_at).setZone(m.timezone).toFormat('d LLL, H:mm')}
                    </span>
                  </div>
                  {e.callback_phone_e164 ? (
                    <a className="tnum mt-1 inline-block text-action-ink hover:underline" href={`tel:${e.callback_phone_e164}`}>{e.callback_phone_e164}</a>
                  ) : null}
                  <p className="mt-1">{e.summary}</p>
                  {e.fields && Object.keys(e.fields).length ? (
                    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-[0.9rem]">
                      {Object.entries(e.fields as Record<string, string>).map(([k, v]) => (
                        <div key={k} className="contents">
                          <dt className="text-ink-faint">{k.replace(/_/g, ' ')}</dt>
                          <dd>{v}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </div>
                <form action={act}>
                  <input type="hidden" name="id" value={e.id} />
                  <input type="hidden" name="status" value={done ? 'new' : 'done'} />
                  <button className="btn btn-quiet">{done ? 'Reopen' : 'Mark handled'}</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
