'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { AgentPublishError, OpenAICompatibleChatModel, activateVersion, createDraftVersion, publishVersion, runAgentSimulation } from '@vp/server';
import { CAPABILITIES } from '@vp/core';
import { requirePlatformStaff } from '@/lib/auth';
import { serverDb } from '@/lib/db';
import { llmConfig } from '@/lib/env';

export type ActionState = { ok?: string; error?: string };

async function adminOnly() {
  const s = await requirePlatformStaff();
  if (s.role !== 'platform_admin') throw new AgentPublishError('Only platform admins can change assistants.');
  return s;
}

async function agentFor(orgId: string) {
  const { rows } = await serverDb().query(`select id from public.agents where organization_id = $1 order by created_at limit 1`, [orgId]);
  if (!rows[0]) throw new AgentPublishError('This client has no assistant yet.');
  return rows[0].id as string;
}

export async function saveDraft(orgId: string, _: ActionState, form: FormData): Promise<ActionState> {
  try {
    const s = await adminOnly();
    const input = z
      .object({
        agentName: z.string().trim().min(1).max(40),
        customInstructions: z.string().max(2000),
        maxCallDurationSec: z.coerce.number().int().min(60).max(3600),
        voiceId: z.string().trim().max(100),
      })
      .parse({ agentName: form.get('agentName'), customInstructions: form.get('customInstructions') ?? '', maxCallDurationSec: form.get('maxCallDurationSec'), voiceId: form.get('voiceId') ?? '' });
    const caps = form.getAll('capabilities').map(String).filter((c): c is (typeof CAPABILITIES)[number] => (CAPABILITIES as readonly string[]).includes(c));
    if (!caps.length) return { error: 'Choose at least one thing the assistant can do.' };
    await createDraftVersion(serverDb(), {
      organizationId: orgId,
      agentId: await agentFor(orgId),
      actorUserId: s.userId,
      patch: {
        agentName: input.agentName,
        customInstructions: input.customInstructions,
        maxCallDurationSec: input.maxCallDurationSec,
        enabledCapabilities: caps,
        transcriptsEnabled: form.get('transcriptsEnabled') === 'on',
        voice: { provider: 'eu_native', voiceId: input.voiceId || 'unassigned', speed: 1 },
      },
    });
    revalidatePath(`/admin/clients/${orgId}/assistant`);
    return { ok: 'New draft saved. Run the test calls before publishing.' };
  } catch (e) {
    return { error: e instanceof z.ZodError ? 'Check the fields: ' + e.issues.map((i) => i.path.join('.')).join(', ') : (e as Error).message };
  }
}

export async function runTests(orgId: string, versionId: string, _: ActionState): Promise<ActionState> {
  try {
    const s = await adminOnly();
    const cfg = llmConfig();
    if (!cfg) return { error: 'Test calls need an AI model connection. Set LLM_BASE_URL and LLM_API_KEY for the web app.' };
    const r = await runAgentSimulation(serverDb(), { versionId, model: new OpenAICompatibleChatModel(cfg), actorUserId: s.userId });
    revalidatePath(`/admin/clients/${orgId}/assistant`);
    return r.passed ? { ok: `All ${r.results.length} test calls passed.` } : { error: `${r.results.filter((x) => !x.passed).length} of ${r.results.length} test calls failed. Read the transcripts below.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function publish(orgId: string, versionId: string, _: ActionState): Promise<ActionState> {
  try {
    const s = await adminOnly();
    await publishVersion(serverDb(), { versionId, actorUserId: s.userId });
    revalidatePath(`/admin/clients/${orgId}`, 'layout');
    return { ok: 'Published. New calls use this version straight away.' };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function makeActive(orgId: string, versionId: string, _: ActionState): Promise<ActionState> {
  try {
    const s = await adminOnly();
    await activateVersion(serverDb(), { agentId: await agentFor(orgId), versionId, actorUserId: s.userId });
    revalidatePath(`/admin/clients/${orgId}/assistant`);
    return { ok: 'Switched. New calls use this version.' };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
