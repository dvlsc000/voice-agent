import { detectEscalation, type CompiledAgent, type IndustryTemplate, type Language } from '@vp/core';
import { toolSpecs } from '../llm/tool-specs';
import { LlmUnavailableError, type ChatMessage, type ChatModel, type ToolCall } from '../llm/types';
import type { CallSession, ToolExecutor, ToolResult } from '../tool-executor';

export type CallOutcome =
  | 'booked'
  | 'rescheduled'
  | 'cancelled'
  | 'info_given'
  | 'message_taken'
  | 'lead_captured'
  | 'transferred'
  | 'escalated'
  | 'abandoned'
  | 'failed'
  | 'other';

export type EngineOutput =
  | { type: 'say'; text: string }
  | { type: 'action'; action: NonNullable<ToolResult['action']> }
  | { type: 'event'; name: string; data?: Record<string, unknown> };

export interface TranscriptSegment {
  role: 'caller' | 'agent';
  text: string;
  at: string;
}

const OUTCOME_PRIORITY: CallOutcome[] = ['escalated', 'booked', 'rescheduled', 'cancelled', 'lead_captured', 'message_taken', 'transferred', 'failed', 'info_given'];

const FALLBACK_LINES: Record<Language, { trouble: string; repeat: string }> = {
  en: {
    trouble: "Sorry, I'm having trouble on my side right now.",
    repeat: "Sorry, I didn't quite get that. Could you say it again?",
  },
  hr: {
    trouble: 'Oprostite, trenutačno imam tehničkih poteškoća.',
    repeat: 'Oprostite, nisam dobro razumio. Možete li ponoviti?',
  },
};

/** Split streamed text into speakable sentences as soon as each one is complete. */
export function takeSentences(buffer: string, flush = false): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let rest = buffer;
  const re = /^(.*?[.!?…])(\s+)(?=\S)/s;
  let m: RegExpMatchArray | null;
  while ((m = rest.match(re))) {
    const s = m[1]!.trim();
    if (s) sentences.push(s);
    rest = rest.slice(m[0].length);
  }
  if (flush && rest.trim()) {
    sentences.push(rest.trim());
    rest = '';
  }
  return { sentences, rest };
}

export interface EngineOptions {
  maxHistoryMessages?: number;
  maxToolRounds?: number;
  now?: () => Date;
}

/**
 * Text-level conversation logic shared by live calls and simulations:
 * prompt + bounded history, streaming model output split into sentences, tool execution through the
 * authorized ToolExecutor, a deterministic escalation safety net, and outcome tracking.
 */
export class ConversationEngine {
  readonly messages: ChatMessage[];
  readonly transcript: TranscriptSegment[] = [];
  private readonly outcomes = new Set<CallOutcome>();
  escalationRuleId: string | null = null;
  llmFailures = 0;
  private readonly opts: Required<EngineOptions>;

  constructor(
    private readonly deps: { model: ChatModel; tools: ToolExecutor },
    readonly session: CallSession,
    private readonly agent: CompiledAgent,
    private readonly template: IndustryTemplate,
    opts: EngineOptions = {},
  ) {
    this.opts = { maxHistoryMessages: 30, maxToolRounds: 4, now: () => new Date(), ...opts };
    const today = this.opts.now().toLocaleDateString('en-CA', { timeZone: session.timezone }); // YYYY-MM-DD
    const weekday = this.opts.now().toLocaleDateString('en-GB', { timeZone: session.timezone, weekday: 'long' });
    this.messages = [
      { role: 'system', content: `${agent.systemPrompt}\n\nToday is ${weekday} ${today} (${session.timezone}). Caller ID: ${session.callerIdE164 ?? 'withheld'}.` },
    ];
  }

  get language(): Language {
    return this.session.language;
  }

  greeting(): string {
    const g = this.agent.firstMessage;
    this.messages.push({ role: 'assistant', content: g });
    this.record('agent', g);
    return g;
  }

  outcome(): CallOutcome {
    for (const o of OUTCOME_PRIORITY) if (this.outcomes.has(o)) return o;
    return this.transcript.some((t) => t.role === 'caller') ? 'other' : 'abandoned';
  }

  markOutcome(o: CallOutcome): void {
    this.outcomes.add(o);
  }

  private record(role: TranscriptSegment['role'], text: string): void {
    this.transcript.push({ role, text, at: this.opts.now().toISOString() });
  }

  /** Called when the caller interrupts: keep only what was actually said aloud in history. */
  truncateLastAgentMessage(spokenText: string): void {
    const last = this.messages.at(-1);
    if (last?.role === 'assistant' && !last.toolCalls?.length) {
      last.content = spokenText ? `${spokenText}…` : '…';
      const seg = [...this.transcript].reverse().find((t) => t.role === 'agent');
      if (seg) seg.text = last.content;
    }
  }

  /** Internal guidance goes into the system prompt (some APIs reject mid-conversation system messages). */
  private addNote(note: string): void {
    const sys = this.messages[0]!;
    if (sys.role === 'system') sys.content += `\n\n[Call note] ${note}`;
  }

  private trimHistory(): void {
    const max = this.opts.maxHistoryMessages;
    if (this.messages.length <= max + 1) return;
    // Keep system prompt; drop oldest turns, never splitting an assistant tool call from its results.
    let cut = this.messages.length - max;
    while (cut < this.messages.length && this.messages[cut]?.role === 'tool') cut++;
    this.messages.splice(1, cut - 1);
  }

  private trackOutcome(name: string, r: ToolResult): void {
    const status = (r.data as { status?: string } | undefined)?.status;
    if (name === 'book_appointment' && status === 'confirmed') this.outcomes.add('booked');
    if (name === 'reschedule_booking' && status === 'confirmed') this.outcomes.add('rescheduled');
    if (name === 'cancel_booking' && status === 'cancelled') this.outcomes.add('cancelled');
    if (name === 'take_message' && r.ok) this.outcomes.add('message_taken');
    if (name === 'request_callback' && r.ok) this.outcomes.add('escalated');
    if (name === 'capture_lead' && r.ok) this.outcomes.add('lead_captured');
    if (name === 'get_business_info' && r.ok) this.outcomes.add('info_given');
    if (name === 'transfer_to_human' && r.action?.type === 'transfer') this.outcomes.add('transferred');
  }

  private async runTool(call: ToolCall): Promise<ToolResult> {
    let args: unknown;
    try {
      args = JSON.parse(call.arguments || '{}');
    } catch {
      return { ok: false, guidance: 'The action arguments were not valid. Ask the caller again for the details.' };
    }
    const r = await this.deps.tools.execute(this.session, call.name, args, call.id);
    this.trackOutcome(call.name, r);
    return r;
  }

  /**
   * Handle one complete caller utterance. Yields sentences to speak (as soon as each is ready),
   * actions (transfer/hang up) and diagnostic events. Abort `signal` on barge-in.
   */
  async *respond(userText: string, signal?: AbortSignal): AsyncGenerator<EngineOutput> {
    const text = userText.trim();
    if (!text) return;
    this.record('caller', text);
    this.messages.push({ role: 'user', content: text });
    this.trimHistory();

    // Deterministic safety net — runs whatever the model would have done.
    const esc = detectEscalation(text, this.template, this.language);
    if (esc) {
      this.escalationRuleId = esc.ruleId;
      const rule = this.template.escalation.find((r) => r.id === esc.ruleId)!;
      yield { type: 'event', name: 'escalation.detected', data: { ruleId: esc.ruleId, action: esc.action } };
      if (esc.action === 'emergency_instructions') {
        this.outcomes.add('escalated');
        const line = rule.script[this.language];
        this.record('agent', line);
        this.messages.push({ role: 'assistant', content: line });
        yield { type: 'say', text: line };
        this.addNote(`Emergency instructions were already given (rule ${esc.ruleId}). Do not repeat them; offer an urgent callback if appropriate. Never give medical advice.`);
      } else if (esc.action === 'transfer_now' && this.session.ctx.agentToolAllowlist.includes('transfer_to_human')) {
        const r = await this.deps.tools.execute(this.session, 'transfer_to_human', { reason: `escalation:${esc.ruleId}` });
        this.trackOutcome('transfer_to_human', r);
        if (r.action) {
          const line = rule.script[this.language];
          this.record('agent', line);
          this.messages.push({ role: 'assistant', content: line });
          yield { type: 'say', text: line };
          yield { type: 'action', action: r.action };
          return;
        }
        this.addNote('The caller asked for a person but nobody is available. Apologise and offer to take a message.');
      } else {
        this.addNote(`Escalation rule "${esc.ruleId}" matched (${rule.trigger.en}). Required handling: ${esc.action}. Follow it.`);
      }
    }

    const tools = toolSpecs(this.agent.tools);
    for (let round = 0; round < this.opts.maxToolRounds; round++) {
      let buffer = '';
      let spoken = '';
      const calls: ToolCall[] = [];
      try {
        for await (const ev of this.deps.model.stream({ messages: this.messages, tools, signal })) {
          if (signal?.aborted) return;
          if (ev.type === 'text') {
            buffer += ev.delta;
            const { sentences, rest } = takeSentences(buffer);
            buffer = rest;
            for (const s of sentences) {
              spoken += (spoken ? ' ' : '') + s;
              yield { type: 'say', text: s };
            }
          } else if (ev.type === 'tool_call') {
            calls.push(ev.call);
          } else if (ev.type === 'done' && ev.usage) {
            yield { type: 'event', name: 'llm.usage', data: ev.usage };
          }
        }
      } catch (e) {
        if (signal?.aborted) return;
        this.llmFailures++;
        yield { type: 'event', name: 'llm.error', data: { message: (e as Error).message.slice(0, 200), unavailable: e instanceof LlmUnavailableError } };
        const line = FALLBACK_LINES[this.language].trouble;
        this.record('agent', line);
        yield { type: 'say', text: line };
        yield { type: 'event', name: 'llm.failed' }; // the call session decides: transfer, message, or hang up
        return;
      }
      const tail = takeSentences(buffer, true).sentences;
      for (const s of tail) {
        spoken += (spoken ? ' ' : '') + s;
        yield { type: 'say', text: s };
      }

      this.messages.push({ role: 'assistant', content: spoken, ...(calls.length ? { toolCalls: calls } : {}) });
      if (spoken) this.record('agent', spoken);
      if (!calls.length) return;

      let terminal: NonNullable<ToolResult['action']> | null = null;
      for (const call of calls) {
        if (signal?.aborted) return;
        const r = await this.runTool(call);
        yield { type: 'event', name: 'tool', data: { name: call.name, ok: r.ok } };
        this.messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: JSON.stringify({ ok: r.ok, data: r.data ?? null, guidance: r.guidance ?? null }) });
        if (r.action) terminal = r.action;
      }
      if (terminal) {
        // Let the model say one closing line if it hasn't, then act.
        if (!spoken && terminal.type === 'transfer') {
          const line = this.language === 'hr' ? 'Spajam vas.' : 'Putting you through now.';
          this.record('agent', line);
          yield { type: 'say', text: line };
        }
        yield { type: 'action', action: terminal };
        return;
      }
    }
    // Too many tool rounds without a reply: don't leave the caller in silence.
    const line = FALLBACK_LINES[this.language].repeat;
    this.record('agent', line);
    yield { type: 'say', text: line };
  }
}
