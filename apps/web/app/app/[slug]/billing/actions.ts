'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createCheckout, createPortal } from '@vp/server';
import { requireMembership } from '@/lib/auth';
import { billingConfig } from '@/lib/billing';
import { serverDb } from '@/lib/db';

export async function startCheckout(slug: string, form: FormData): Promise<void> {
  const m = await requireMembership(slug, ['owner']);
  const cfg = billingConfig();
  if (!cfg) redirect(`/app/${slug}/billing?checkout=unavailable`);
  const plan = z.string().regex(/^[a-z0-9_]+$/).parse(form.get('plan'));
  redirect(await createCheckout(serverDb(), cfg, { organizationId: m.organizationId, planCode: plan }));
}

export async function openPortal(slug: string): Promise<void> {
  const m = await requireMembership(slug, ['owner']);
  const cfg = billingConfig();
  if (!cfg) redirect(`/app/${slug}/billing?checkout=unavailable`);
  redirect(await createPortal(serverDb(), cfg, m.organizationId));
}
