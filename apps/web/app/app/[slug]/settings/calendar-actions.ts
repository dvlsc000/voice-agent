'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { VaultSecretStore, disconnectCalendar } from '@vp/server';
import { getUser, requireMembership } from '@/lib/auth';
import { serverDb } from '@/lib/db';
import { supabaseServer } from '@/lib/supabase/server';

/** Point a staff member at a calendar on a connected account ("primary" = the account's main calendar). */
export async function assignStaffCalendar(slug: string, form: FormData): Promise<void> {
  const m = await requireMembership(slug, ['owner', 'manager']);
  const input = z
    .object({ staffId: z.string().uuid(), connectionId: z.string().uuid().or(z.literal('')), calendarId: z.string().trim().max(200) })
    .parse({ staffId: form.get('staffId'), connectionId: form.get('connectionId') ?? '', calendarId: form.get('calendarId') ?? '' });
  const sb = await supabaseServer();
  // RLS + composite FK guarantee the connection belongs to this business.
  const { error } = await sb
    .from('staff_members')
    .update({ calendar_connection_id: input.connectionId || null, external_calendar_id: input.connectionId ? input.calendarId || 'primary' : null })
    .eq('id', input.staffId)
    .eq('organization_id', m.organizationId);
  if (error) throw new Error(error.message);
  revalidatePath(`/app/${slug}/settings`);
}

export async function disconnect(slug: string, form: FormData): Promise<void> {
  const m = await requireMembership(slug, ['owner', 'manager']);
  const connectionId = z.string().uuid().parse(form.get('connectionId'));
  const user = await getUser();
  const db = serverDb();
  await disconnectCalendar(db, new VaultSecretStore(db), { organizationId: m.organizationId, connectionId, actorUserId: user?.id ?? null });
  revalidatePath(`/app/${slug}/settings`);
}
