import { DateTime } from 'luxon';
import { Lamp } from '@/components/lamp';
import { Empty, PageHeader } from '@/components/page-header';
import { requirePlatformStaff } from '@/lib/auth';
import { serverDb } from '@/lib/db';
import { telephonyEnv } from '@/lib/env';
import { openIncident, resolveIncident, retryJob } from './actions';

export const metadata = { title: 'Operations' };
export const dynamic = 'force-dynamic';

const ago = (d: Date | string) => DateTime.fromJSDate(new Date(d)).toRelative();

async function gatewayHealth(): Promise<{ ok: boolean; detail: string }> {
  const t = telephonyEnv();
  if (!t) return { ok: false, detail: 'Voice gateway URL not configured' };
  try {
    const r = await fetch(`${t.gatewayUrl}/health`, { signal: AbortSignal.timeout(3000), cache: 'no-store' });
    const j = (await r.json()) as { activeCalls?: number };
    return { ok: r.ok, detail: r.ok ? `${j.activeCalls ?? 0} calls in progress` : `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}

export default async function OperationsPage() {
  await requirePlatformStaff();
  const db = serverDb();
  const [jobs, queue, webhooks, notifs, integrations, incidents, failedCalls, gw] = await Promise.all([
    db.query(`select j.id, j.kind, j.attempts, j.last_error, j.created_at, o.name from public.jobs j left join public.organizations o on o.id = j.organization_id where j.status = 'dead' order by j.created_at desc limit 50`),
    db.query(`select count(*) filter (where status = 'queued' and run_at <= now())::int as due, count(*) filter (where status = 'running' and locked_at < now() - interval '5 minutes')::int as stuck, min(run_at) filter (where status = 'queued' and run_at <= now()) as oldest from public.jobs`),
    db.query(`select provider, event_type, error, received_at from public.webhook_events where status = 'failed' and received_at > now() - interval '7 days' order by received_at desc limit 20`),
    db.query(`select n.channel, n.template, n.error, n.created_at, o.name from public.notifications n join public.organizations o on o.id = n.organization_id where n.status = 'failed' and n.created_at > now() - interval '7 days' order by n.created_at desc limit 20`),
    db.query(`select c.provider, c.status, c.last_error, o.name from public.integration_connections c join public.organizations o on o.id = c.organization_id where c.status = 'error'`),
    db.query(`select id, title, severity, component, status, opened_at from public.incidents where status <> 'resolved' order by opened_at desc`),
    db.query(`select c.id, c.started_at, c.outcome, o.name from public.calls c join public.organizations o on o.id = c.organization_id where c.outcome = 'failed' and c.started_at > now() - interval '24 hours' order by c.started_at desc limit 20`),
    gatewayHealth(),
  ]);
  const q = queue.rows[0];
  const Section = ({ id, title, children }: { id: string; title: string; children: React.ReactNode }) => (
    <section aria-labelledby={id} className="mb-8"><h2 id={id} className="mb-2">{title}</h2><div className="sheet">{children}</div></section>
  );
  return (
    <>
      <PageHeader title="Operations" detail="Everything that needs a person. Empty sections mean nothing is wrong." />
      <Section id="h-sys" title="Systems">
        <ul className="divide-y divide-rule">
          <li className="flex justify-between px-4 py-2.5"><span>Voice gateway</span><Lamp tone={gw.ok ? 'green' : 'red'}>{gw.detail}</Lamp></li>
          <li className="flex justify-between px-4 py-2.5"><span>Background jobs waiting</span><span className="tnum">{q.due}{q.oldest ? ` (oldest ${ago(q.oldest)})` : ''}</span></li>
          <li className="flex justify-between px-4 py-2.5"><span>Jobs stuck running over 5 minutes</span><span className={`tnum ${q.stuck ? 'text-lamp-red' : ''}`}>{q.stuck}</span></li>
        </ul>
      </Section>
      <Section id="h-inc" title="Open incidents">
        {incidents.rows.length ? (
          <ul className="divide-y divide-rule">
            {incidents.rows.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <span><Lamp tone={i.severity === 'sev1' ? 'red' : 'amber'}>{i.severity.toUpperCase()}</Lamp> <span className="ml-2 font-medium">{i.title}</span> <span className="text-ink-faint">{i.component ? `${i.component}, ` : ''}opened {ago(i.opened_at)}</span></span>
                <form action={resolveIncident}><input type="hidden" name="id" value={i.id} /><button className="btn btn-quiet">Resolve</button></form>
              </li>
            ))}
          </ul>
        ) : <Empty title="No open incidents." />}
        <form action={openIncident} className="grid gap-3 border-t border-rule p-4 sm:grid-cols-[1fr_8rem_10rem_auto] sm:items-end">
          <label className="field"><span>Open an incident</span><input className="input" name="title" placeholder="What is happening?" required /></label>
          <label className="field"><span>Severity</span><select className="input" name="severity" defaultValue="sev2"><option value="sev1">SEV1 — calls failing</option><option value="sev2">SEV2 — degraded</option><option value="sev3">SEV3 — minor</option></select></label>
          <label className="field"><span>Component</span><input className="input" name="component" placeholder="telephony, LLM…" /></label>
          <button className="btn btn-primary">Open</button>
        </form>
      </Section>
      <Section id="h-calls" title="Failed calls, last 24 hours">
        {failedCalls.rows.length ? (
          <ul className="divide-y divide-rule">{failedCalls.rows.map((c) => <li key={c.id} className="flex justify-between px-4 py-2.5"><span>{c.name}</span><span className="tnum text-ink-soft">{DateTime.fromJSDate(c.started_at).toFormat('d LLL H:mm')}</span></li>)}</ul>
        ) : <Empty title="No failed calls." />}
      </Section>
      <Section id="h-jobs" title="Failed background jobs">
        {jobs.rows.length ? (
          <ul className="divide-y divide-rule">
            {jobs.rows.map((j) => (
              <li key={j.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_auto]">
                <div><span className="font-medium">{j.kind.replace(/_/g, ' ')}</span>{j.name ? <span className="text-ink-soft"> · {j.name}</span> : null}<p className="text-[0.9rem] text-lamp-red">{j.last_error}</p><p className="text-[0.85rem] text-ink-faint">{j.attempts} attempts, created {ago(j.created_at)}</p></div>
                <form action={retryJob}><input type="hidden" name="id" value={j.id} /><button className="btn btn-quiet">Retry</button></form>
              </li>
            ))}
          </ul>
        ) : <Empty title="No failed jobs." />}
      </Section>
      <Section id="h-int" title="Calendar connections needing attention">
        {integrations.rows.length ? <ul className="divide-y divide-rule">{integrations.rows.map((i, k) => <li key={k} className="px-4 py-2.5"><span className="font-medium">{i.name}</span> — {i.last_error}</li>)}</ul> : <Empty title="All connected calendars are working." />}
      </Section>
      <Section id="h-wh" title="Failed webhooks, last 7 days">
        {webhooks.rows.length ? <ul className="divide-y divide-rule">{webhooks.rows.map((w, k) => <li key={k} className="px-4 py-2.5">{w.provider} {w.event_type}: <span className="text-lamp-red">{w.error}</span> <span className="text-ink-faint">{ago(w.received_at)}</span></li>)}</ul> : <Empty title="No failed webhooks." />}
      </Section>
      <Section id="h-n" title="Undelivered emails and texts, last 7 days">
        {notifs.rows.length ? <ul className="divide-y divide-rule">{notifs.rows.map((n, k) => <li key={k} className="px-4 py-2.5">{n.name}: {n.channel} {n.template.replace(/_/g, ' ')} — <span className="text-lamp-red">{n.error}</span></li>)}</ul> : <Empty title="Everything was delivered." />}
      </Section>
    </>
  );
}
