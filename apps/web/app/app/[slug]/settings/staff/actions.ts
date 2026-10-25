'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { toE164 } from '@vp/core';
import { requireMembership } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export async function addStaff(slug: string, form: FormData): Promise<void> {
  const m = await requireMembership(slug, ['owner', 'manager']);
  const name = z.string().trim().min(1).max(100).parse(form.get('name'));
  const sb = await supabaseServer();
  const { data: loc } = await sb.from('locations').select('id').eq('organization_id', m.organizationId).eq('is_primary', true).maybeSingle();
  const { data: staff, error } = await sb.from('staff_members').insert({ organization_id: m.organizationId, display_name: name, location_id: loc?.id ?? null }).select('id').single();
  if (error) throw new Error(error.message);
  // Start from the business's opening hours; adjust per person below.
  const { data: hours } = await sb.from('business_hours').select('weekday, opens, closes').eq('organization_id', m.organizationId);
  if (hours?.length) {
    await sb.from('staff_hours').insert(hours.map((h) => ({ organization_id: m.organizationId, staff_id: staff.id, weekday: h.weekday, starts: h.opens, ends: h.closes })));
  }
  revalidatePath(`/app/${slug}/settings/staff`);
}

export async function saveStaff(slug: string, form: FormData): Promise<void> {
  const m = await requireMembership(slug, ['owner', 'manager']);
  const id = z.string().uuid().parse(form.get('id'));
  const name = z.string().trim().min(1).max(100).parse(form.get('name'));
  const aliases = String(form.get('aliases') ?? '').split(',').map((a) => a.trim()).filter(Boolean).slice(0, 10);
  const country = (form.get('country') === 'HR' ? 'HR' : 'IE') as 'IE' | 'HR';
  const rawPhone = String(form.get('transferPhone') ?? '').trim();
  const transfer = rawPhone ? toE164(rawPhone, country) : null;
  if (rawPhone && !transfer) throw new Error('The transfer number is not a valid phone number.');
  const hours: Array<{ weekday: number; starts: string; ends: string }> = [];
  for (let d = 1; d <= 7; d++) {
    if (form.get(`on-${d}`) !== 'on') continue;
    const starts = time.parse(form.get(`s-${d}`));
    const ends = time.parse(form.get(`e-${d}`));
    if (ends <= starts) throw new Error('Each working day needs a start time before its end time.');
    hours.push({ weekday: d, starts, ends });
  }
  const sb = await supabaseServer();
  const up = await sb.from('staff_members').update({ display_name: name, aliases, bookable: form.get('bookable') === 'on', active: form.get('active') === 'on', transfer_phone_e164: transfer }).eq('id', id).eq('organization_id', m.organizationId);
  if (up.error) throw new Error(up.error.message);
  await sb.from('staff_hours').delete().eq('staff_id', id).eq('organization_id', m.organizationId);
  if (hours.length) {
    const ins = await sb.from('staff_hours').insert(hours.map((h) => ({ ...h, organization_id: m.organizationId, staff_id: id })));
    if (ins.error) throw new Error(ins.error.message);
  }
  revalidatePath(`/app/${slug}/settings/staff`);
}
