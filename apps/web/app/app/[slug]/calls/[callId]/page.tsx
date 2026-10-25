import { notFound } from 'next/navigation';
import { DateTime } from 'luxon';
import { OUTCOME_LABEL } from '@/components/lamp';
import { PageHeader } from '@/components/page-header';
import { requireMembership } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';

export const metadata = { title: 'Call' };

export default async function CallDetail({ params }: { params: Promise<{ slug: string; callId: string }> }) {
  const { slug, callId } = await params;
  const m = await requireMembership(slug);
  const sb = await supabaseServer();
  const { data: call } = await sb
    .from('calls')
    .select('id, started_at, duration_sec, outcome, from_e164, summary, language')
    .eq('organization_id', m.organizationId)
    .eq('id', callId)
    .maybeSingle();
  if (!call) notFound();
  // RLS returns nothing for analysts or when transcripts are disabled/expired — the UI just says so.
  const { data: transcript } = await sb.from('call_transcripts').select('segments, retain_until').eq('call_id', callId).maybeSingle();
  const when = DateTime.fromISO(call.started_at).setZone(m.timezone);
  return (
    <>
      <PageHeader title={OUTCOME_LABEL[call.outcome ?? ''] ?? 'Call'} detail={`${when.toFormat('cccc d LLLL, H:mm')} · ${call.duration_sec ?? 0} seconds`} />
      {call.summary ? <p className="sheet mb-6 max-w-[70ch] p-4">{call.summary}</p> : null}
      <section aria-labelledby="t-h">
        <h2 id="t-h" className="mb-2">Conversation</h2>
        {!transcript ? (
          <p className="text-ink-soft">The transcript isn’t available. Transcripts may be turned off, deleted under your retention settings, or hidden for your role.</p>
        ) : (
          <ol className="sheet grid max-w-[70ch] gap-3 p-4">
            {(transcript.segments as Array<{ role: string; text: string }>).map((s, i) => (
              <li key={i} className={s.role === 'agent' ? 'text-ink-soft' : ''}>
                <span className="mr-2 text-[0.8rem] font-semibold text-ink-faint">{s.role === 'agent' ? 'Assistant' : 'Caller'}</span>
                {s.text}
              </li>
            ))}
          </ol>
        )}
        {transcript ? (
          <p className="mt-2 text-[0.85rem] text-ink-faint">Deleted automatically on {DateTime.fromISO(transcript.retain_until).toFormat('d LLLL yyyy')}.</p>
        ) : null}
      </section>
    </>
  );
}
