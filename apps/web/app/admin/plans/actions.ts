'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requirePlatformStaff } from '@/lib/auth';
import { serverDb } from '@/lib/db';

const euros = z.string().trim().regex(/^\d+([.,]\d{1,2})?$/).transform((v) => Math.round(Number(v.replace(',', '.')) * 100));

export async function savePlan(form: FormData): Promise<void> {
  const s = await requirePlatformStaff();
  if (s.role !== 'platform_admin') throw new Error('Only platform admins can change prices.');
  const p = z
    .object({
      code: z.string().regex(/^[a-z0-9_]+$/),
      name: z.string().trim().min(1).max(60),
      price: euros,
      includedMinutes: z.coerce.number().int().min(0),
      overage: euros,
      stripePriceId: z.string().trim().max(100),
      stripeMeterPriceId: z.string().trim().max(100),
    })
    .parse(Object.fromEntries(form));
  const active = form.get('active') === 'on';
  if (active && (!p.stripePriceId || p.price <= 0)) throw new Error('An active plan needs a price and a Stripe price ID.');
  await serverDb().tx(
    (q) => q.query(
      `update public.plans set name = $2, price_minor = $3, included_minutes = $4, overage_per_minute_minor = $5,
              stripe_price_id = nullif($6, ''), stripe_overage_price_id = nullif($7, ''), active = $8, is_public = $9 where code = $1`,
      [p.code, p.name, p.price, p.includedMinutes, p.overage, p.stripePriceId, p.stripeMeterPriceId, active, form.get('isPublic') === 'on'],
    ),
    { actorUserId: s.userId },
  );
  revalidatePath('/admin/plans');
}
