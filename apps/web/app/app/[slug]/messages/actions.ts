'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireMembership } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';

export async function setEnquiryStatus(slug: string, form: FormData): Promise<void> {
  const m = await requireMembership(slug, ['owner', 'manager', 'receptionist']);
  const input = z.object({ id: z.string().uuid(), status: z.enum(['new', 'done']) }).parse({ id: form.get('id'), status: form.get('status') });
  const sb = await supabaseServer();
  // RLS + column grants enforce tenant and role; the organization filter is belt and braces.
  const { error } = await sb
    .from('enquiries')
    .update({ status: input.status, resolved_at: input.status === 'done' ? new Date().toISOString() : null })
    .eq('id', input.id)
    .eq('organization_id', m.organizationId);
  if (error) throw new Error(error.message);
  revalidatePath(`/app/${slug}`, 'layout');
}
