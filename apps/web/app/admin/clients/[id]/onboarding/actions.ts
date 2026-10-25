'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  GoLiveBlockedError,
  TwilioNumbers,
  UnsafeUrlError,
  applyImportSuggestions,
  goLive,
  importFromWebsite,
  registerPhoneNumber,
  setOnboardingTask,
  type ImportSuggestions,
} from '@vp/server';
import { requirePlatformStaff } from '@/lib/auth';
import { serverDb } from '@/lib/db';
import { telephonyEnv } from '@/lib/env';

export type State = { ok?: string; error?: string };

async function admin() {
  const s = await requirePlatformStaff();
  if (s.role !== 'platform_admin') throw new Error('Only platform admins can change client setup.');
  return s;
}
const country = async (orgId: string) => (await serverDb().query(`select country from public.organizations where id = $1`, [orgId])).rows[0].country as 'IE' | 'HR';
const done = (orgId: string) => revalidatePath(`/admin/clients/${orgId}`, 'layout');

export async function runImport(orgId: string, _: State, form: FormData): Promise<State> {
  try {
    await admin();
    const url = z.string().url().parse(String(form.get('url') ?? '').trim());
    const result = await importFromWebsite(url);
    await serverDb().query(`update public.onboarding_sessions set answers = answers || jsonb_build_object('website_import', $2::jsonb) where organization_id = $1`, [orgId, JSON.stringify(result)]);
    done(orgId);
    return { ok: 'Website read. Check the suggestions below before applying any of them.' };
  } catch (e) {
    if (e instanceof z.ZodError) return { error: 'Enter a full web address, for example https://example.ie' };
    if (e instanceof UnsafeUrlError) return { error: e.message };
    return { error: `Couldn’t read that website: ${(e as Error).message}` };
  }
}

export async function applyImport(orgId: string, _: State, form: FormData): Promise<State> {
  try {
    const s = await admin();
    const row = (await serverDb().query(`select answers -> 'website_import' as imp from public.onboarding_sessions where organization_id = $1`, [orgId])).rows[0];
    if (!row?.imp) return { error: 'Read a website first.' };
    const r = await applyImportSuggestions(serverDb(), {
      organizationId: orgId,
      suggestions: row.imp as ImportSuggestions,
      apply: { address: form.get('address') === 'on', phone: form.get('phone') === 'on', hours: form.get('hours') === 'on', services: form.getAll('service').map(String) },
      country: await country(orgId),
      actorUserId: s.userId,
    });
    done(orgId);
    return { ok: r.applied.length ? `Applied: ${r.applied.map((a) => a.replace('service:', '')).join(', ')}. New prices still need approving.` : 'Nothing selected, nothing changed.' };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function connectNumber(orgId: string, _: State, form: FormData): Promise<State> {
  try {
    const s = await admin();
    const mode = z.enum(['twilio_existing', 'forwarded']).parse(form.get('mode'));
    const raw = z.string().trim().min(6).parse(form.get('e164'));
    const c = await country(orgId);
    if (mode === 'twilio_existing') {
      const t = telephonyEnv();
      if (!t) return { error: 'Twilio isn’t configured for the console (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, VOICE_GATEWAY_URL).' };
      const { toE164 } = await import('@vp/core');
      const e164 = toE164(raw, c);
      if (!e164) return { error: 'That is not a valid phone number.' };
      const { sid } = await new TwilioNumbers({ accountSid: t.accountSid, authToken: t.authToken }).configureExisting({ e164, voiceUrl: `${t.gatewayUrl}/twilio/voice`, statusCallback: `${t.gatewayUrl}/twilio/status` });
      await registerPhoneNumber(serverDb(), { organizationId: orgId, e164, country: c, connectionType: 'provider_number', provider: 'twilio', providerNumberId: sid, status: 'active', actorUserId: s.userId });
      done(orgId);
      return { ok: `${e164} now rings the assistant (once the client is live).` };
    }
    // The client keeps their number and forwards it to one of ours; it's live when they switch on forwarding.
    await registerPhoneNumber(serverDb(), { organizationId: orgId, e164: raw, country: c, connectionType: 'forwarded', provider: 'twilio', status: 'active', actorUserId: s.userId });
    done(orgId);
    return { ok: 'Recorded. Ask the client to forward their calls to this number.' };
  } catch (e) {
    return { error: /duplicate key/.test((e as Error).message) ? 'That number is already connected to a client.' : (e as Error).message };
  }
}

export async function markSupervisedCall(orgId: string, _: State): Promise<State> {
  try {
    const s = await admin();
    await setOnboardingTask(serverDb(), { organizationId: orgId, kind: 'supervised_test_call', status: 'done', actorUserId: s.userId });
    done(orgId);
    return { ok: 'Recorded.' };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function activate(orgId: string, _: State): Promise<State> {
  try {
    const s = await admin();
    await goLive(serverDb(), { organizationId: orgId, actorUserId: s.userId });
    done(orgId);
    return { ok: 'Live. Calls to this client’s number are now answered by the assistant.' };
  } catch (e) {
    if (e instanceof GoLiveBlockedError) return { error: `Not yet: ${e.blockers.join('; ')}.` };
    return { error: (e as Error).message };
  }
}
