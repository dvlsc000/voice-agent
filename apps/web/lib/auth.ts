import 'server-only';
import { redirect, notFound } from 'next/navigation';
import { cache } from 'react';
import { supabaseServer } from './supabase/server';

export type MemberRole = 'owner' | 'manager' | 'receptionist' | 'analyst';

export const getUser = cache(async () => {
  const sb = await supabaseServer();
  // getUser() re-validates the JWT with Supabase Auth; never trust getSession() alone on the server.
  const { data } = await sb.auth.getUser();
  return data.user ?? null;
});

export async function requireUser() {
  const user = await getUser();
  if (!user) redirect('/login');
  return user;
}

export interface Membership {
  organizationId: string;
  slug: string;
  name: string;
  role: MemberRole;
  timezone: string;
  primaryLanguage: 'en' | 'hr';
  status: string;
}

/** Memberships read through RLS — a user can only ever see organizations they belong to. */
export const getMemberships = cache(async (): Promise<Membership[]> => {
  const user = await requireUser();
  const sb = await supabaseServer();
  const { data, error } = await sb
    .from('organization_members')
    .select('role, organizations!inner(id, slug, name, timezone, primary_language, status)')
    .eq('user_id', user.id);
  if (error) throw new Error(error.message);
  return (data ?? []).map((m: any) => ({
    organizationId: m.organizations.id,
    slug: m.organizations.slug,
    name: m.organizations.name,
    role: m.role,
    timezone: m.organizations.timezone,
    primaryLanguage: m.organizations.primary_language,
    status: m.organizations.status,
  }));
});

export async function requireMembership(slug: string, roles?: MemberRole[]): Promise<Membership> {
  const m = (await getMemberships()).find((x) => x.slug === slug);
  if (!m) notFound(); // do not reveal whether the organization exists
  if (roles && !roles.includes(m.role)) redirect(`/app/${slug}?denied=1`);
  return m;
}

/**
 * Platform operators (our company). Requires MFA (AAL2) — admin compromise is the highest-impact risk.
 */
export async function requirePlatformStaff(): Promise<{ userId: string; role: 'platform_admin' | 'platform_support' }> {
  const user = await requireUser();
  const sb = await supabaseServer();
  const { data: staff } = await sb.from('platform_staff').select('role').eq('user_id', user.id).maybeSingle();
  if (!staff) notFound();
  const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== 'aal2') redirect('/mfa');
  return { userId: user.id, role: staff.role };
}
