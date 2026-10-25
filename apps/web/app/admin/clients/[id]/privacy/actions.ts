'use server';
import { revalidatePath } from 'next/cache';
import { eraseSubjectData, normaliseSubject } from '@vp/server';
import { requirePlatformStaff } from '@/lib/auth';
import { serverDb } from '@/lib/db';

export type State = { ok?: string; error?: string };

export async function erase(orgId: string, _: State, form: FormData): Promise<State> {
  const s = await requirePlatformStaff();
  if (s.role !== 'platform_admin') return { error: 'Only platform admins can erase data.' };
  if (form.get('confirm') !== 'ERASE') return { error: 'Type ERASE to confirm. This cannot be undone.' };
  if (form.get('verified') !== 'on') return { error: 'Confirm that the business verified the person’s identity.' };
  try {
    const org = (await serverDb().query(`select country from public.organizations where id = $1`, [orgId])).rows[0];
    const subject = normaliseSubject({ phone: String(form.get('phone') ?? ''), email: String(form.get('email') ?? '') }, org.country);
    const r = await eraseSubjectData(serverDb(), orgId, subject, s.userId);
    revalidatePath(`/admin/clients/${orgId}/privacy`);
    return { ok: `Done: ${Object.entries(r).map(([k, v]) => `${v} ${k.replace(/_/g, ' ')}`).join(', ')}.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
