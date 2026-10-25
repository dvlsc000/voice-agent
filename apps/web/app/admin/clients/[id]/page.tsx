import { notFound } from 'next/navigation';
import { DateTime } from 'luxon';
import { blockersFor } from '@vp/server';
import { Lamp } from '@/components/lamp';
import { PageHeader } from '@/components/page-header';
import { requirePlatformStaff } from '@/lib/auth';
import { serverDb } from '@/lib/db';

export const metadata = { title: 'Client' };
export const dynamic = 'force-dynamic';

const STEP_LABEL: Record<string, string> = {
  tenant_created: 'Business record created',
  configuration_applied: 'Industry template applied',
  agent_draft_created: 'Assistant drafted',
  phone_number: 'Phone number connected',
  calendar_connection: 'Calendar connected (optional)',
  simulation_tests: 'Automated test calls passed',
  supervised_test_call: 'Supervised test call done',
  activation: 'Answering live calls',
};
const TASK_TONE = { done: 'green', pending: 'off', running: 'blue', blocked: 'amber', failed: 'red', skipped: 'off' } as const;
const TASK_LABEL = { done: 'Done', pending: 'To do', running: 'In progress', blocked: 'Waiting', failed: 'Failed', skipped: 'Skipped' } as const;

export default async function ClientDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  await requirePlatformStaff();
  const { id } = await params;
  const { created } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = serverDb();
  const org = (
    await db.query(
      `select o.*, s.plan_code, s.status as billing_status, ss.answers ->> 'owner_email' as owner_email
         from public.organizations o
         left join public.subscriptions s on s.organization_id = o.id
         left join public.onboarding_sessions ss on ss.organization_id = o.id
        where o.id = $1`,
      [id],
    )
  ).rows[0];
  if (!org) notFound();
  const [tasks, members, services, staff, version, blockers] = await Promise.all([
    db.query(`select kind, status, blocked_reason from public.onboarding_tasks where organization_id = $1`, [id]),
    db.query(`select u.email, m.role from public.organization_members m join auth.users u on u.id = m.user_id where m.organization_id = $1 order by m.role`, [id]),
    db.query(`select names, duration_min, price_minor, price_approved from public.services where organization_id = $1 and active order by sort_order`, [id]),
    db.query(`select display_name from public.staff_members where organization_id = $1 and active order by display_name`, [id]),
    db.query(
      `select v.version_no, v.status, v.compiled ->> 'firstMessage' as greeting, v.compiled -> 'tools' as tools, v.created_at
         from public.agent_versions v join public.agents a on a.id = v.agent_id where a.organization_id = $1 order by v.version_no desc limit 1`,
      [id],
    ),
    blockersFor(db, id),
  ]);
  const taskByKind = new Map(tasks.rows.map((t) => [t.kind, t]));
  const v = version.rows[0];
  const lang = org.primary_language as 'en' | 'hr';

  return (
    <>
      {created ? <p role="status" className="mb-4 rounded-md border border-lamp-green bg-lamp-green-wash px-4 py-3">Client created. Work through the checklist below to put the assistant live.</p> : null}
      <PageHeader title={org.name} detail={`${org.industry_template_id.replace(/_/g, ' ')} in ${org.country === 'IE' ? 'Ireland' : 'Croatia'}, answering in ${lang === 'en' ? 'English' : 'Croatian'}${org.additional_languages?.length ? ' and ' + (lang === 'en' ? 'Croatian' : 'English') : ''}.`} />

      <div className="grid gap-8 lg:grid-cols-[3fr_2fr]">
        <section aria-labelledby="h-steps">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 id="h-steps">Going live</h2>
            <a href={`/admin/clients/${id}/onboarding`} className="text-[0.9rem] text-action-ink hover:underline">Set up and go live</a>
          </div>
          <ol className="sheet divide-y divide-rule">
            {Object.entries(STEP_LABEL).map(([kind, label], i) => {
              const t = taskByKind.get(kind);
              const status = (t?.status ?? 'pending') as keyof typeof TASK_TONE;
              return (
                <li key={kind} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span><span className="tnum mr-2 text-ink-faint">{i + 1}.</span>{label}{t?.blocked_reason ? <span className="block text-[0.85rem] text-lamp-amber-ink">{t.blocked_reason}</span> : null}</span>
                  <Lamp tone={TASK_TONE[status]}>{TASK_LABEL[status]}</Lamp>
                </li>
              );
            })}
          </ol>
          {blockers.length ? (
            <div className="mt-4">
              <h3 className="mb-1 font-semibold">Still needed before going live</h3>
              <ul className="list-disc pl-5 text-ink-soft">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
            </div>
          ) : null}

          <div className="mt-8 mb-2 flex items-baseline justify-between">
            <h2>Assistant</h2>
            <a href={`/admin/clients/${id}/assistant`} className="text-[0.9rem] text-action-ink hover:underline">Settings, tests and versions</a>
          </div>
          {v ? (
            <div className="sheet p-4">
              <p className="text-[0.85rem] text-ink-faint">Version {v.version_no}, {v.status}, created {DateTime.fromJSDate(v.created_at).toFormat('d LLL yyyy')}</p>
              <p className="mt-2">Greeting: “{v.greeting}”</p>
              <p className="mt-2 text-[0.9rem] text-ink-soft">Can: {(v.tools as string[]).map((t) => t.replace(/_/g, ' ')).join(', ')}</p>
            </div>
          ) : (
            <p className="text-ink-soft">No assistant drafted.</p>
          )}
        </section>

        <aside className="grid content-start gap-8">
          <section aria-labelledby="h-people">
            <h2 id="h-people" className="mb-2">People</h2>
            <ul className="sheet divide-y divide-rule">
              {members.rows.length === 0 ? (
                <li className="px-4 py-3 text-ink-soft">Invitation not sent yet{org.owner_email ? ` to ${org.owner_email}` : ''}. Add a Supabase secret key to send invitations from here.</li>
              ) : (
                members.rows.map((m) => <li key={m.email} className="flex justify-between px-4 py-2.5"><span>{m.email}</span><span className="text-ink-soft">{m.role}</span></li>)
              )}
            </ul>
          </section>
          <section aria-labelledby="h-svc">
            <h2 id="h-svc" className="mb-2">Services</h2>
            <ul className="sheet divide-y divide-rule">
              {services.rows.map((s, i) => (
                <li key={i} className="flex justify-between gap-3 px-4 py-2.5">
                  <span>{s.names[lang] ?? s.names.en}<span className="block text-[0.85rem] text-ink-faint">{s.duration_min} min</span></span>
                  {s.price_minor == null ? <span className="text-ink-faint">No price</span> : s.price_approved ? <span className="tnum">€{(s.price_minor / 100).toFixed(2)}</span> : <Lamp tone="amber">Price unapproved</Lamp>}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[0.85rem] text-ink-faint">Staff: {staff.rows.map((s) => s.display_name).join(', ') || 'none'}</p>
          </section>
          <section aria-labelledby="h-bill">
            <h2 id="h-bill" className="mb-2">Billing</h2>
            <p className="mb-3"><a href={`/admin/clients/${id}/privacy`} className="text-action-ink hover:underline">Privacy requests (access and erasure)</a></p>
            <p className="sheet px-4 py-3">Plan {org.plan_code ?? 'none'} · {org.billing_status === 'incomplete' ? 'no payment method yet' : org.billing_status}</p>
          </section>
        </aside>
      </div>
    </>
  );
}
