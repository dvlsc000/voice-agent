import { PageHeader } from '@/components/page-header';
import { SettingsTabs } from '@/components/settings-tabs';
import { getUser, requireMembership } from '@/lib/auth';
import { serverDb } from '@/lib/db';
import { changeRole, inviteMember } from './actions';
import { InviteForm } from './invite-form';

export const metadata = { title: 'Team' };
const ROLE: Record<string, string> = { owner: 'Owner', manager: 'Manager', receptionist: 'Front desk', analyst: 'View only' };

export default async function TeamPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireMembership(slug, ['owner', 'manager']);
  const me = await getUser();
  // Emails live in auth.users, which the browser session can't read; membership was authorised above.
  const { rows } = await serverDb().query(
    `select m.user_id, m.role, u.email, u.last_sign_in_at from public.organization_members m join auth.users u on u.id = m.user_id where m.organization_id = $1 order by m.role, u.email`,
    [m.organizationId],
  );
  const isOwner = m.role === 'owner';
  const change = changeRole.bind(null, slug);
  return (
    <>
      <PageHeader title="Settings" detail="People who can sign in to this dashboard." />
      <SettingsTabs slug={slug} active="/team" />
      {isOwner ? <InviteForm action={inviteMember.bind(null, slug)} /> : null}
      <ul className="sheet divide-y divide-rule">
        {rows.map((r) => (
          <li key={r.user_id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <span>{r.email}{r.user_id === me?.id ? <span className="ml-2 text-ink-faint">(you)</span> : null}{!r.last_sign_in_at ? <span className="ml-2 text-[0.85rem] text-lamp-amber-ink">invited, not signed in yet</span> : null}</span>
            {isOwner && r.user_id !== me?.id ? (
              <form action={change} className="flex items-center gap-2">
                <input type="hidden" name="userId" value={r.user_id} />
                <select className="input" name="role" defaultValue={r.role} aria-label={`Role for ${r.email}`}>
                  {Object.entries(ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  <option value="remove">Remove access</option>
                </select>
                <button className="btn btn-quiet">Save</button>
              </form>
            ) : <span className="text-ink-soft">{ROLE[r.role]}</span>}
          </li>
        ))}
      </ul>
    </>
  );
}
