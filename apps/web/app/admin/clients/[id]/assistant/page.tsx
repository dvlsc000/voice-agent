import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DateTime } from 'luxon';
import { templateSchema } from '@vp/core';
import { ActionButton } from '@/components/action-button';
import { Lamp } from '@/components/lamp';
import { PageHeader } from '@/components/page-header';
import { requirePlatformStaff } from '@/lib/auth';
import { serverDb } from '@/lib/db';
import { llmConfig } from '@/lib/env';
import { makeActive, publish, runTests, saveDraft } from './actions';
import { SettingsForm } from './settings-form';

export const metadata = { title: 'Assistant' };
export const dynamic = 'force-dynamic';

const STATUS: Record<string, { tone: 'green' | 'blue' | 'amber' | 'off'; label: string }> = {
  published: { tone: 'green', label: 'Published' },
  testing: { tone: 'blue', label: 'Tested' },
  draft: { tone: 'amber', label: 'Draft' },
  archived: { tone: 'off', label: 'Archived' },
};

export default async function AssistantPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePlatformStaff();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = serverDb();
  const org = (await db.query(`select id, name from public.organizations where id = $1`, [id])).rows[0];
  if (!org) notFound();
  const agent = (await db.query(`select id, active_version_id from public.agents where organization_id = $1 order by created_at limit 1`, [id])).rows[0];
  const versions = agent
    ? (
        await db.query(
          `select v.id, v.version_no, v.status, v.settings, v.created_at, v.published_at, v.compiled ->> 'firstMessage' as greeting,
                  r.status as test_status, r.passed, r.failed, r.results, r.created_at as tested_at
             from public.agent_versions v left join public.agent_test_runs r on r.id = v.test_run_id
            where v.agent_id = $1 order by v.version_no desc`,
          [agent.id],
        )
      ).rows
    : [];
  const latest = versions[0];
  const template = (await db.query(`select definition from public.industry_templates t join public.agent_versions v on v.template_id = t.id and v.template_version = t.version where v.id = $1`, [latest?.id])).rows[0];
  const allowed: string[] = template ? templateSchema.parse(template.definition).allowedCapabilities : [];
  const hasModel = !!llmConfig();
  const s = latest?.settings ?? {};

  return (
    <>
      <p className="mb-2"><Link href={`/admin/clients/${id}`} className="text-action-ink hover:underline">{org.name}</Link></p>
      <PageHeader title="Assistant" detail="Changes become a new version. A version can go live only after its test calls pass. Older published versions can be switched back on instantly." />

      {latest ? (
        <section aria-labelledby="h-latest" className="mb-10">
          <h2 id="h-latest" className="mb-2">Version {latest.version_no}</h2>
          <div className="sheet grid gap-4 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <Lamp tone={STATUS[latest.status]!.tone}>{STATUS[latest.status]!.label}</Lamp>
              {agent?.active_version_id === latest.id ? <span className="text-ink-soft">Answering calls now</span> : null}
            </div>
            {latest.status !== 'published' ? (
              <>
                <ActionButton
                  action={runTests.bind(null, id, latest.id)}
                  label="Run test calls"
                  pendingLabel="Running test calls… (up to a minute)"
                  disabled={!hasModel}
                  hint={hasModel ? 'Uses the real model with this client’s real details. Bookings and messages are simulated.' : 'Connect an AI model (LLM_BASE_URL, LLM_API_KEY) to run test calls.'}
                />
                <ActionButton
                  action={publish.bind(null, id, latest.id)}
                  label="Publish this version"
                  pendingLabel="Publishing…"
                  variant="primary"
                  disabled={latest.test_status !== 'passed'}
                  hint={latest.test_status === 'passed' ? undefined : 'Available once all test calls pass.'}
                />
              </>
            ) : null}
            {latest.results?.length ? (
              <div>
                <h3 className="mb-2 font-semibold">
                  Test calls, {DateTime.fromJSDate(latest.tested_at).toFormat('d LLL, H:mm')}: {latest.passed} passed, {latest.failed} failed
                </h3>
                <ul className="divide-y divide-rule rounded-md border border-rule">
                  {(latest.results as Array<{ id: string; language: string; passed: boolean; failures: string[]; transcript: Array<{ role: string; text: string }> }>).map((r) => (
                    <li key={r.id} className="px-3 py-2">
                      <details>
                        <summary className="flex cursor-pointer items-center justify-between gap-3">
                          <span>{r.id.replace(/_/g, ' ')} <span className="text-ink-faint">({r.language === 'hr' ? 'Croatian' : 'English'})</span></span>
                          <Lamp tone={r.passed ? 'green' : 'red'}>{r.passed ? 'Passed' : 'Failed'}</Lamp>
                        </summary>
                        {r.failures.length ? <ul className="mt-2 list-disc pl-5 text-lamp-red">{r.failures.map((f) => <li key={f}>{f}</li>)}</ul> : null}
                        <ol className="mt-2 grid gap-1.5 text-[0.9rem]">
                          {r.transcript.map((t, i) => (
                            <li key={i} className={t.role === 'agent' ? 'text-ink-soft' : ''}><span className="mr-2 font-semibold text-ink-faint">{t.role === 'agent' ? 'Assistant' : 'Caller'}</span>{t.text}</li>
                          ))}
                        </ol>
                      </details>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="h-edit" className="mb-10">
        <h2 id="h-edit" className="mb-2">Change settings</h2>
        <SettingsForm
          action={saveDraft.bind(null, id)}
          allowed={allowed}
          current={{
            agentName: s.agentName ?? 'Nora',
            enabledCapabilities: s.enabledCapabilities ?? [],
            customInstructions: s.customInstructions ?? '',
            maxCallDurationSec: s.maxCallDurationSec ?? 900,
            transcriptsEnabled: !!s.transcriptsEnabled,
            voiceId: s.voice?.voiceId ?? 'unassigned',
          }}
        />
      </section>

      <section aria-labelledby="h-hist">
        <h2 id="h-hist" className="mb-2">All versions</h2>
        <div className="sheet overflow-x-auto">
          <table className="table min-w-[560px]">
            <thead><tr><th>Version</th><th>Status</th><th>Created</th><th>Tests</th><th /></tr></thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id}>
                  <td className="tnum">{v.version_no}{agent?.active_version_id === v.id ? <span className="ml-2 text-[0.85rem] text-lamp-green">live</span> : null}</td>
                  <td><Lamp tone={STATUS[v.status]!.tone}>{STATUS[v.status]!.label}</Lamp></td>
                  <td className="tnum text-ink-soft">{DateTime.fromJSDate(v.created_at).toFormat('d LLL yyyy, H:mm')}</td>
                  <td>{v.test_status ? `${v.passed} passed, ${v.failed} failed` : '—'}</td>
                  <td>
                    {v.status === 'published' && agent?.active_version_id !== v.id ? (
                      <ActionButton action={makeActive.bind(null, id, v.id)} label="Switch back to this" pendingLabel="Switching…" />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
