'use server';
import { redirect } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { ZodError } from 'zod';
import { provisionClient } from '@vp/server';
import { requirePlatformStaff } from '@/lib/auth';
import { serverDb } from '@/lib/db';
import { publicEnv, supabaseSecretKey } from '@/lib/env';

export type CreateState = { error?: string; fields?: Record<string, string> };

const FIELD_LABEL: Record<string, string> = {
  businessName: 'Business name', contactEmail: 'Business email', ownerEmail: 'Owner’s email', fallbackPhone: 'Fallback phone number', websiteUrl: 'Website',
};

export async function createClientAction(_: CreateState, form: FormData): Promise<CreateState> {
  const staff = await requirePlatformStaff();
  if (staff.role !== 'platform_admin') return { error: 'Only platform admins can create clients.' };
  const get = (k: string) => {
    const v = form.get(k);
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
  };
  const days = [1, 2, 3, 4, 5, 6, 7].filter((d) => form.get(`day-${d}`) === 'on');
  const primary = (get('primaryLanguage') ?? 'en') as 'en' | 'hr';
  const input = {
    businessName: get('businessName') ?? '',
    industry: get('industry') as never,
    country: get('country') as never,
    primaryLanguage: primary,
    additionalLanguages: form.get('bilingual') === 'on' ? [primary === 'en' ? 'hr' : 'en'] : [],
    addressLine: get('addressLine'),
    city: get('city'),
    websiteUrl: get('websiteUrl'),
    contactEmail: get('contactEmail') ?? '',
    ownerEmail: get('ownerEmail') ?? '',
    fallbackPhone: get('fallbackPhone'),
    hours: days.map((weekday) => ({ weekday, opens: get('opens') ?? '09:00', closes: get('closes') ?? '17:00' })),
    staff: (get('staff') ?? '').split('\n').map((s) => s.trim()).filter(Boolean).map((name) => ({ name })),
  } as const;

  let organizationId: string;
  try {
    const r = await provisionClient(serverDb(), input as never, { actorUserId: staff.userId, idempotencyKey: String(form.get('idempotencyKey')) });
    organizationId = r.organizationId;
  } catch (e) {
    if (e instanceof ZodError) {
      const first = e.issues[0]!;
      const field = String(first.path[0] ?? '');
      return { error: `${FIELD_LABEL[field] ?? field}: ${first.message}` };
    }
    throw e;
  }

  // Invite the owner. Without a secret key configured, the invitation stays pending on the onboarding checklist.
  const secret = supabaseSecretKey();
  if (secret) {
    const admin = createClient(publicEnv().NEXT_PUBLIC_SUPABASE_URL, secret, { auth: { persistSession: false } });
    const { data, error } = await admin.auth.admin.inviteUserByEmail(input.ownerEmail, { redirectTo: `${publicEnv().NEXT_PUBLIC_SITE_URL}/auth/callback` });
    if (!error && data.user) {
      await serverDb().tx(
        (q) => q.query(`insert into public.organization_members (organization_id, user_id, role) values ($1, $2, 'owner') on conflict do nothing`, [organizationId, data.user!.id]),
        { actorUserId: staff.userId },
      );
    }
  }
  redirect(`/admin/clients/${organizationId}?created=1`);
}
