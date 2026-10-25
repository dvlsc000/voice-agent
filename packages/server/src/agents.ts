import { randomUUID } from 'node:crypto';
import {
  agentSettingsSchema,
  compileAgent,
  templateSchema,
  toolsForCapabilities,
  type AgentSettings,
  type IndustryTemplate,
} from '@vp/core';
import { BookingService } from './booking-service';
import { renderBusinessFacts } from './business-facts';
import { ConversationEngine, type CallOutcome, type EngineOutput } from './conversation/engine';
import type { Db } from './db';
import type { ChatModel } from './llm/types';
import { ToolExecutor, type CallSession } from './tool-executor';

/** Settings an operator or owner may change; everything else comes from the template. */
export type AgentSettingsPatch = Partial<Pick<AgentSettings,
  'agentName' | 'additionalLanguages' | 'allowLanguageSwitch' | 'formality' | 'enabledCapabilities' | 'voice' | 'pronunciations' |
  'customInstructions' | 'maxCallDurationSec' | 'recordingEnabled' | 'transcriptsEnabled'>>;

export class AgentPublishError extends Error {
  override name = 'AgentPublishError';
}

async function loadVersion(db: Db, versionId: string) {
  const { rows } = await db.query(
    `select v.*, o.name as org_name, o.timezone, o.status as org_status, t.definition
       from public.agent_versions v
       join public.organizations o on o.id = v.organization_id
       join public.industry_templates t on t.id = v.template_id and t.version = v.template_version
      where v.id = $1`,
    [versionId],
  );
  if (!rows[0]) throw new AgentPublishError('Agent version not found');
  return { ...rows[0], template: templateSchema.parse(rows[0].definition) as IndustryTemplate, settings: rows[0].settings as AgentSettings };
}

/**
 * New draft from the latest version + a validated patch. Settings are data, never code (spec §28).
 * Recording can only be enabled where the template allows it and a legal decision exists — enforced in the UI and here.
 */
export async function createDraftVersion(db: Db, input: { organizationId: string; agentId: string; patch: AgentSettingsPatch; actorUserId: string | null; allowRecording?: boolean }): Promise<string> {
  return db.tx(async (q) => {
    const { rows } = await q.query(
      `select v.version_no, v.settings, v.template_id, v.template_version, t.definition
         from public.agent_versions v join public.industry_templates t on t.id = v.template_id and t.version = v.template_version
        where v.agent_id = $1 and v.organization_id = $2 order by v.version_no desc limit 1 for update`,
      [input.agentId, input.organizationId],
    );
    const prev = rows[0];
    if (!prev) throw new AgentPublishError('Agent has no versions');
    const template = templateSchema.parse(prev.definition);
    const merged = agentSettingsSchema.parse({ ...prev.settings, ...input.patch });
    if (merged.recordingEnabled && !input.allowRecording) throw new AgentPublishError('Call recording needs a recorded legal decision for this client before it can be enabled.');
    merged.enabledCapabilities = merged.enabledCapabilities.filter((c) => template.allowedCapabilities.includes(c));
    const id = randomUUID();
    await q.query(
      `insert into public.agent_versions (id, organization_id, agent_id, version_no, template_id, template_version, settings, status, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, 'draft', $8)`,
      [id, input.organizationId, input.agentId, prev.version_no + 1, prev.template_id, prev.template_version, JSON.stringify(merged), input.actorUserId],
    );
    return id;
  }, { actorUserId: input.actorUserId });
}

export interface ScenarioResult {
  id: string;
  language: 'en' | 'hr';
  passed: boolean;
  failures: string[];
  outcome: CallOutcome;
  toolsUsed: string[];
  transcript: Array<{ role: 'caller' | 'agent'; text: string }>;
}

/** Follow-up lines for a simulated caller (kept generic so they suit every template). */
const FOLLOW_UPS = {
  en: ["Yes, the first one is perfect. My name is Alex Byrne and my number is 087 123 4567.", 'Yes, that is all correct, go ahead.', "No, that's everything, thanks."],
  hr: ['Da, prvi termin mi odgovara. Zovem se Ivana Horvat, broj 091 234 5678.', 'Da, sve je točno, samo naprijed.', 'Ne, to je sve, hvala.'],
};

function outcomeMatches(expected: string, actual: CallOutcome): boolean {
  if (expected === 'info_given') return actual === 'info_given' || actual === 'other';
  if (expected === 'escalated') return actual === 'escalated' || actual === 'transferred';
  return expected === actual;
}

/**
 * Runs the template's evaluation scenarios as text conversations against a real model and the client's real
 * configuration. Writes (bookings, messages, transfers) are simulated, so tests never touch live diaries.
 * A scripted model makes this deterministic in CI; a real model is what gates publishing in production.
 */
export async function runAgentSimulation(db: Db, input: { versionId: string; model: ChatModel; actorUserId: string | null; maxTurns?: number }): Promise<{ runId: string; passed: boolean; results: ScenarioResult[] }> {
  const v = await loadVersion(db, input.versionId);
  const runId = randomUUID();
  await db.query(`insert into public.agent_test_runs (id, organization_id, agent_version_id, status, model, created_by) values ($1, $2, $3, 'running', $4, $5)`, [
    runId, v.organization_id, v.id, input.model.id, input.actorUserId,
  ]);
  const results: ScenarioResult[] = [];
  try {
    for (const sc of v.template.evaluationScenarios) {
      const language = sc.language as 'en' | 'hr';
      // Only run scenarios for languages this client actually answers in.
      if (language !== v.settings.primaryLanguage && !(v.settings.additionalLanguages ?? []).includes(language)) continue;
      const settings: AgentSettings = { ...v.settings, primaryLanguage: language };
      const facts = await renderBusinessFacts(db, v.organization_id, language);
      const agent = compileAgent(v.template, settings, { businessName: v.org_name, timezone: v.timezone, factsText: facts });
      const toolsUsed: string[] = [];
      const tools = new ToolExecutor({ db, booking: new BookingService({ db }), dryRun: true });
      const session: CallSession = {
        ctx: {
          organizationId: v.organization_id, callId: `sim-${runId}`, agentVersionId: v.id, enabledCapabilities: settings.enabledCapabilities,
          agentToolAllowlist: toolsForCapabilities(settings.enabledCapabilities).filter((t) => agent.tools.includes(t)),
          verifiedBookingIds: new Set(), offeredSlots: new Set(), toolCallsSoFar: 0, consequentialCallsSoFar: 0, organizationStatus: 'active',
        },
        callerIdE164: language === 'hr' ? '+385912345678' : '+353871234567',
        timezone: v.timezone,
        language,
        verificationAttempts: 0,
      };
      const engine = new ConversationEngine({ model: input.model, tools }, session, agent, v.template);
      engine.greeting();
      const agentText: string[] = [];
      const lines = [sc.callerScript, ...FOLLOW_UPS[language]].slice(0, input.maxTurns ?? 4);
      let ended = false;
      for (const line of lines) {
        if (ended) break;
        for await (const out of engine.respond(line) as AsyncGenerator<EngineOutput>) {
          if (out.type === 'say') agentText.push(out.text);
          if (out.type === 'event' && out.name === 'tool') toolsUsed.push(String(out.data?.name));
          if (out.type === 'action') ended = true;
        }
      }
      const outcome = engine.outcome();
      const failures: string[] = [];
      for (const t of sc.expect.tools) if (!toolsUsed.includes(t)) failures.push(`expected the assistant to use ${t}`);
      for (const t of sc.expect.forbiddenTools) if (toolsUsed.includes(t)) failures.push(`the assistant used ${t}, which is not allowed here`);
      const said = agentText.join(' ').toLowerCase();
      for (const phrase of sc.expect.mustNotSay) if (said.includes(phrase.toLowerCase())) failures.push(`the assistant said "${phrase}"`);
      if (!outcomeMatches(sc.expect.outcome, outcome)) failures.push(`expected outcome ${sc.expect.outcome}, got ${outcome}`);
      if (engine.llmFailures > 0) failures.push('the model failed during the conversation');
      results.push({ id: sc.id, language, passed: failures.length === 0, failures, outcome, toolsUsed, transcript: engine.transcript.map(({ role, text }) => ({ role, text })) });
    }
    const passed = results.length > 0 && results.every((r) => r.passed);
    await db.query(
      `update public.agent_test_runs set status = $2, passed = $3, failed = $4, results = $5, finished_at = now() where id = $1`,
      [runId, passed ? 'passed' : 'failed', results.filter((r) => r.passed).length, results.filter((r) => !r.passed).length, JSON.stringify(results)],
    );
    await db.query(`update public.agent_versions set test_run_id = $2, status = case when status = 'draft' then 'testing'::public.agent_version_status else status end where id = $1`, [v.id, runId]);
    return { runId, passed, results };
  } catch (e) {
    await db.query(`update public.agent_test_runs set status = 'error', results = $2, finished_at = now() where id = $1`, [runId, JSON.stringify([{ error: (e as Error).message }])]);
    throw e;
  }
}

/**
 * Publish = freeze + compile + make active. Requires a passing test run for THIS version.
 * The previous published version stays published (immutable) so it can be reactivated instantly.
 */
export async function publishVersion(db: Db, input: { versionId: string; actorUserId: string | null; skipTestsReason?: string }): Promise<void> {
  const v = await loadVersion(db, input.versionId);
  if (v.status === 'published') throw new AgentPublishError('This version is already published');
  if (!input.skipTestsReason) {
    const run = v.test_run_id ? (await db.query(`select status from public.agent_test_runs where id = $1`, [v.test_run_id])).rows[0] : null;
    if (run?.status !== 'passed') throw new AgentPublishError('Run the test calls and get them all passing before publishing.');
  }
  const facts = await renderBusinessFacts(db, v.organization_id, v.settings.primaryLanguage);
  const compiled = compileAgent(v.template, v.settings, { businessName: v.org_name, timezone: v.timezone, factsText: facts });
  await db.tx(async (q) => {
    await q.query(
      `update public.agent_versions set compiled = $2, content_hash = $3, status = 'published', published_at = now(), published_by = $4 where id = $1`,
      [v.id, JSON.stringify(compiled), compiled.contentHash, input.actorUserId],
    );
    await q.query(`update public.agents set active_version_id = $2 where id = $1`, [v.agent_id, v.id]);
    await q.query(
      `update public.onboarding_tasks set status = 'done', result = $2 where organization_id = $1 and kind = 'simulation_tests'`,
      [v.organization_id, JSON.stringify({ versionId: v.id, skipped: input.skipTestsReason ?? null })],
    );
  }, { actorUserId: input.actorUserId });
}

/** Roll back (or forward) to any previously published version. */
export async function activateVersion(db: Db, input: { agentId: string; versionId: string; actorUserId: string | null }): Promise<void> {
  const { rowCount } = await db.tx(
    (q) => q.query(
      `update public.agents a set active_version_id = v.id from public.agent_versions v
        where a.id = $1 and v.id = $2 and v.agent_id = a.id and v.status = 'published'`,
      [input.agentId, input.versionId],
    ),
    { actorUserId: input.actorUserId },
  );
  if (!rowCount) throw new AgentPublishError('Only published versions of this assistant can be made active.');
}
