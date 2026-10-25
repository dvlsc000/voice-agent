'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireMembership } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export type SaveState = { ok?: boolean; error?: string };

export async function saveHours(slug: string, _: SaveState, form: FormData): Promise<SaveState> {
  const m = await requireMembership(slug, ['owner', 'manager']);
  const rows: Array<{ weekday: number; opens: string; closes: string }> = [];
  for (let d = 1; d <= 7; d++) {
    if (form.get(`open-${d}`) !== 'on') continue;
    const opens = time.safeParse(form.get(`opens-${d}`));
    const closes = time.safeParse(form.get(`closes-${d}`));
    if (!opens.success || !closes.success || closes.data <= opens.data) {
      return { error: 'Check the times: each open day needs an opening time before its closing time.' };
    }
    rows.push({ weekday: d, opens: opens.data, closes: closes.data });
  }
  const sb = await supabaseServer();
  const { data: loc } = await sb.from('locations').select('id').eq('organization_id', m.organizationId).eq('is_primary', true).single();
  if (!loc) return { error: 'Add your business address before setting hours.' };
  const del = await sb.from('business_hours').delete().eq('organization_id', m.organizationId).eq('location_id', loc.id);
  if (del.error) return { error: 'Your hours could not be saved. Try again.' };
  if (rows.length) {
    const ins = await sb.from('business_hours').insert(rows.map((r) => ({ ...r, organization_id: m.organizationId, location_id: loc.id })));
    if (ins.error) return { error: 'Your hours could not be saved. Try again.' };
  }
  revalidatePath(`/app/${slug}`, 'layout');
  return { ok: true };
}

export async function saveService(slug: string, form: FormData): Promise<void> {
  const m = await requireMembership(slug, ['owner', 'manager']);
  const input = z
    .object({
      id: z.string().uuid(),
      duration: z.coerce.number().int().min(5).max(600),
      price: z.string().trim().regex(/^(\d+([.,]\d{1,2})?)?$/),
      approve: z.enum(['on']).optional(),
      active: z.enum(['on']).optional(),
    })
    .parse(Object.fromEntries(form));
  const priceMinor = input.price === '' ? null : Math.round(Number(input.price.replace(',', '.')) * 100);
  const sb = await supabaseServer();
  const { error } = await sb
    .from('services')
    .update({ duration_min: input.duration, price_minor: priceMinor, price_approved: priceMinor !== null && input.approve === 'on', active: input.active === 'on' })
    .eq('id', input.id)
    .eq('organization_id', m.organizationId);
  if (error) throw new Error(error.message);
  revalidatePath(`/app/${slug}/settings`);
}
