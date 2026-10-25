'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireMembership } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';

export async function addClosure(slug: string, form: FormData): Promise<void> {
  const m = await requireMembership(slug, ['owner', 'manager']);
  const input = z
    .object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      staffId: z.string().uuid().or(z.literal('')),
      kind: z.enum(['closed', 'special']),
      opens: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      closes: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      label: z.string().trim().max(80),
    })
    .parse({ date: form.get('date'), staffId: form.get('staffId') ?? '', kind: form.get('kind'), opens: form.get('opens') || undefined, closes: form.get('closes') || undefined, label: form.get('label') ?? '' });
  if (input.kind === 'special' && (!input.opens || !input.closes || input.closes <= input.opens)) throw new Error('Special hours need an opening time before the closing time.');
  const sb = await supabaseServer();
  const { error } = await sb.from('date_exceptions').insert(
    {
      organization_id: m.organizationId,
      staff_id: input.staffId || null,
      date: input.date,
      closed: input.kind === 'closed',
      ranges: input.kind === 'special' ? [{ start: input.opens, end: input.closes }] : [],
      label: input.label || null,
    },
  );
  if (error) throw new Error(/duplicate/.test(error.message) ? 'There is already an entry for that day. Remove it first.' : error.message);
  revalidatePath(`/app/${slug}/settings/closures`);
}

export async function removeClosure(slug: string, form: FormData): Promise<void> {
  const m = await requireMembership(slug, ['owner', 'manager']);
  const id = z.string().uuid().parse(form.get('id'));
  const sb = await supabaseServer();
  await sb.from('date_exceptions').delete().eq('id', id).eq('organization_id', m.organizationId);
  revalidatePath(`/app/${slug}/settings/closures`);
}
