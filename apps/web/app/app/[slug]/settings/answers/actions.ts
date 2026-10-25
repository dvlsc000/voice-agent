'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireMembership } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';

export async function addAnswer(slug: string, form: FormData): Promise<void> {
  const m = await requireMembership(slug, ['owner', 'manager']);
  const input = z
    .object({ question: z.string().trim().min(3).max(300), content: z.string().trim().min(2).max(4000), language: z.enum(['en', 'hr']) })
    .parse({ question: form.get('question'), content: form.get('content'), language: form.get('language') });
  const sb = await supabaseServer();
  // Written by the owner/manager themselves, so it is approved on save (stamped with who approved it).
  const { error } = await sb.from('knowledge_items').insert({ organization_id: m.organizationId, kind: 'faq', ...input, status: 'approved', source: 'manual' });
  if (error) throw new Error(error.message);
  revalidatePath(`/app/${slug}/settings/answers`);
}

export async function setAnswerStatus(slug: string, form: FormData): Promise<void> {
  const m = await requireMembership(slug, ['owner', 'manager']);
  const id = z.string().uuid().parse(form.get('id'));
  const status = z.enum(['approved', 'archived']).parse(form.get('status'));
  const sb = await supabaseServer();
  await sb.from('knowledge_items').update({ status }).eq('id', id).eq('organization_id', m.organizationId);
  revalidatePath(`/app/${slug}/settings/answers`);
}
