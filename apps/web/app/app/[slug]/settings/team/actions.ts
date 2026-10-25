'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getUser, requireMembership } from '@/lib/auth';
import { serverDb } from '@/lib/db';
import { publicEnv, supabaseSecretKey } from '@/lib/env';
import { supabaseServer } from '@/lib/supabase/server';

export type State = { ok?: string; error?: string };

export async function inviteMember(slug: string, _: State, form: FormData): Promise<State> {
  const m = await requireMembership(slug, ['owner']);
  const parsed = z.object({ email: z.string().email(), role: z.enum(['manager', 'receptionist', 'analyst']) }).safeParse({ email: form.get('email'), role: form.get('role') });
  if (!parsed.success) return { error: 'Enter an email address and choose a role.' };
  const secret = supabaseSecretKey();
  if (!secret) return { error: 'Invitations aren’t switched on yet. Contact support to add a team member.' };
  const admin = createClient(publicEnv().NEXT_PUBLIC_SUPABASE_URL, secret, { auth: { persistSession: false } });
  const { data, error } = await admin.auth.admin.inviteUserByEmail(parsed.data.email, { redirectTo: `${publicEnv().NEXT_PUBLIC_SITE_URL}/auth/callback` });
  let userId = data?.user?.id;
  if (error) {
    // Already has an account: look them up instead of failing.
    const existing = (await serverDb().query(`select id from auth.users where lower(email) = lower($1)`, [parsed.data.email])).rows[0];
    if (!existing) return { error: 'We couldn’t send the invitation. Check the address and try again.' };
    userId = existing.id;
  }
  const actor = await getUser();
  await serverDb().tx(
    (q) => q.query(`insert into public.organization_members (organization_id, user_id, role) values ($1, $2, $3) on conflict (organization_id, user_id) do update set role = excluded.role`, [m.organizationId, userId, parsed.data.role]),
    { actorUserId: actor?.id ?? null },
  );
  revalidatePath(`/app/${slug}/settings/team`);
  return { ok: `Invitation sent to ${parsed.data.email}.` };
}

export async function changeRole(slug: string, form: FormData): Promise<void> {
  const m = await requireMembership(slug, ['owner']);
  const input = z.object({ userId: z.string().uuid(), role: z.enum(['owner', 'manager', 'receptionist', 'analyst', 'remove']) }).parse({ userId: form.get('userId'), role: form.get('role') });
  const sb = await supabaseServer();
  // RLS: only owners may change membership; the database refuses to remove the last owner.
  const r = input.role === 'remove'
    ? await sb.from('organization_members').delete().eq('organization_id', m.organizationId).eq('user_id', input.userId)
    : await sb.from('organization_members').update({ role: input.role }).eq('organization_id', m.organizationId).eq('user_id', input.userId);
  if (r.error) throw new Error(/at least one owner/.test(r.error.message) ? 'A business must keep at least one owner.' : r.error.message);
  revalidatePath(`/app/${slug}/settings/team`);
}
