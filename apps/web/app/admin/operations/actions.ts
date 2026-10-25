'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requirePlatformStaff } from '@/lib/auth';
import { serverDb } from '@/lib/db';

export async function retryJob(form: FormData): Promise<void> {
  const s = await requirePlatformStaff();
  const id = z.coerce.number().int().parse(form.get('id'));
  await serverDb().tx((q) => q.query(`update public.jobs set status = 'queued', attempts = 0, run_at = now(), last_error = null where id = $1 and status = 'dead'`, [id]), { actorUserId: s.userId });
  revalidatePath('/admin/operations');
}

export async function openIncident(form: FormData): Promise<void> {
  const s = await requirePlatformStaff();
  const i = z.object({ title: z.string().trim().min(3).max(200), severity: z.enum(['sev1', 'sev2', 'sev3']), component: z.string().trim().max(60) }).parse({ title: form.get('title'), severity: form.get('severity'), component: form.get('component') ?? '' });
  await serverDb().tx((q) => q.query(`insert into public.incidents (title, severity, component, details) values ($1, $2, $3, $4)`, [i.title, i.severity, i.component || null, JSON.stringify({ opened_by: s.userId })]), { actorUserId: s.userId });
  revalidatePath('/admin/operations');
}

export async function resolveIncident(form: FormData): Promise<void> {
  const s = await requirePlatformStaff();
  const id = z.string().uuid().parse(form.get('id'));
  await serverDb().tx((q) => q.query(`update public.incidents set status = 'resolved', resolved_at = now() where id = $1`, [id]), { actorUserId: s.userId });
  revalidatePath('/admin/operations');
}
