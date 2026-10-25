import Link from 'next/link';
import { DateTime } from 'luxon';
import { Lamp, OUTCOME_LABEL } from '@/components/lamp';
import { Empty, PageHeader } from '@/components/page-header';
import { requireMembership } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';

export const metadata = { title: 'Calls' };

const mins = (s: number | null) => (s == null ? '—' : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`);

export default async function CallsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireMembership(slug);
  const sb = await supabaseServer();
  const { data, error } = await sb
    .from('calls')
    .select('id, started_at, duration_sec, outcome, from_e164, language, summary')
    .eq('organization_id', m.organizationId)
    .order('started_at', { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  const showNumbers = m.role !== 'analyst';
  return (
    <>
      <PageHeader title="Calls" detail="Every call your assistant answered, newest first." />
      <div className="sheet overflow-x-auto">
        {!data?.length ? (
          <Empty title="No calls yet.">Calls appear here as soon as your assistant starts answering.</Empty>
        ) : (
          <table className="table min-w-[640px]">
            <thead>
              <tr><th>When</th><th>Caller</th><th>Result</th><th>Length</th><th className="w-[40%]">Summary</th></tr>
            </thead>
            <tbody>
              {data.map((c: any) => (
                <tr key={c.id} className="hover:bg-ground">
                  <td className="tnum whitespace-nowrap">
                    <Link className="text-action-ink hover:underline" href={`/app/${slug}/calls/${c.id}`}>
                      {DateTime.fromISO(c.started_at).setZone(m.timezone).toFormat('d LLL, H:mm')}
                    </Link>
                  </td>
                  <td className="tnum">{showNumbers ? c.from_e164 ?? 'Withheld' : 'Hidden'}</td>
                  <td>
                    {c.outcome === 'escalated' ? <Lamp tone="amber">{OUTCOME_LABEL[c.outcome]}</Lamp> : c.outcome === 'failed' ? <Lamp tone="red">{OUTCOME_LABEL[c.outcome]}</Lamp> : OUTCOME_LABEL[c.outcome] ?? 'In progress'}
                  </td>
                  <td className="tnum">{mins(c.duration_sec)}</td>
                  <td className="text-ink-soft">{c.summary ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
