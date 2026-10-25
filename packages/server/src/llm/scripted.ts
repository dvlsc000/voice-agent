import type { ChatMessage, ChatModel, LlmEvent, ToolCall, ToolSpec } from './types';

/**
 * Deterministic model for tests and offline simulations. Each step decides the reply from the conversation so far.
 * NOT a quality signal for real conversations — evals against a real model are separate (see simulation).
 */
export type ScriptStep = (ctx: { messages: ChatMessage[]; tools: ToolSpec[]; lastToolResult: unknown }) => { text?: string; toolCalls?: Array<Omit<ToolCall, 'id'>> };

export class ScriptedChatModel implements ChatModel {
  readonly id = 'scripted';
  calls = 0;
  constructor(private readonly steps: ScriptStep[]) {}
  async *stream(input: { messages: ChatMessage[]; tools: ToolSpec[]; signal?: AbortSignal }): AsyncIterable<LlmEvent> {
    const step = this.steps[Math.min(this.calls, this.steps.length - 1)]!;
    this.calls++;
    const last = [...input.messages].reverse().find((m) => m.role === 'tool');
    const out = step({ messages: input.messages, tools: input.tools, lastToolResult: last && last.role === 'tool' ? JSON.parse(last.content) : undefined });
    if (out.text) {
      for (const word of out.text.split(/(?<= )/)) {
        if (input.signal?.aborted) return;
        yield { type: 'text', delta: word };
      }
    }
    let i = 0;
    for (const c of out.toolCalls ?? []) yield { type: 'tool_call', call: { id: `scripted_${this.calls}_${i++}`, ...c } };
    yield { type: 'done', usage: { inputTokens: 0, outputTokens: 0 } };
  }
}
