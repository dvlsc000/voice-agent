import { LlmUnavailableError, type ChatMessage, type ChatModel, type LlmEvent, type ToolCall, type ToolSpec } from './types';

/**
 * Streaming client for OpenAI-compatible chat-completions APIs (Mistral La Plateforme, Azure OpenAI,
 * vLLM/self-hosted, and others). The endpoint choice decides where data is processed — configure an EU endpoint.
 */
export interface OpenAICompatibleConfig {
  baseUrl: string; // e.g. https://api.mistral.ai/v1
  apiKey: string;
  model: string; // e.g. mistral-small-latest
  /** Azure uses `api-key` header and a deployment URL; everything else uses Bearer. */
  authHeader?: 'bearer' | 'api-key';
  timeoutMs?: number;
  fetch?: typeof fetch;
}

function toWire(m: ChatMessage): Record<string, unknown> {
  switch (m.role) {
    case 'assistant':
      return {
        role: 'assistant',
        content: m.content,
        ...(m.toolCalls?.length
          ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })) }
          : {}),
      };
    case 'tool':
      return { role: 'tool', tool_call_id: m.toolCallId, name: m.name, content: m.content };
    default:
      return { role: m.role, content: m.content };
  }
}

export class OpenAICompatibleChatModel implements ChatModel {
  readonly id: string;
  constructor(private readonly cfg: OpenAICompatibleConfig) {
    this.id = `openai-compatible:${cfg.model}`;
  }

  async *stream(input: { messages: ChatMessage[]; tools: ToolSpec[]; temperature?: number; maxTokens?: number; signal?: AbortSignal }): AsyncIterable<LlmEvent> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('LLM first-token timeout')), this.cfg.timeoutMs ?? 8000);
    input.signal?.addEventListener('abort', () => controller.abort(input.signal?.reason), { once: true });
    let res: Response;
    try {
      res = await (this.cfg.fetch ?? fetch)(`${this.cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          ...(this.cfg.authHeader === 'api-key' ? { 'api-key': this.cfg.apiKey } : { authorization: `Bearer ${this.cfg.apiKey}` }),
        },
        body: JSON.stringify({
          model: this.cfg.model,
          stream: true,
          temperature: input.temperature ?? 0.3,
          max_tokens: input.maxTokens ?? 300,
          messages: input.messages.map(toWire),
          ...(input.tools.length
            ? { tools: input.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })), tool_choice: 'auto' }
            : {}),
        }),
      });
    } catch (e) {
      clearTimeout(timeout);
      if (input.signal?.aborted) return;
      throw new LlmUnavailableError((e as Error).message);
    }
    if (!res.ok || !res.body) {
      clearTimeout(timeout);
      const text = await res.text().catch(() => '');
      throw new LlmUnavailableError(`LLM HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const pending = new Map<number, { id: string; name: string; args: string }>();
    let usage: { inputTokens: number; outputTokens: number } | undefined;
    const decoder = new TextDecoder();
    let buffer = '';
    let first = true;
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        if (first) {
          clearTimeout(timeout);
          first = false;
        }
        buffer += decoder.decode(chunk, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          let json: any;
          try {
            json = JSON.parse(data);
          } catch {
            continue;
          }
          if (json.usage) usage = { inputTokens: json.usage.prompt_tokens ?? 0, outputTokens: json.usage.completion_tokens ?? 0 };
          const delta = json.choices?.[0]?.delta;
          if (!delta) continue;
          if (typeof delta.content === 'string' && delta.content) yield { type: 'text', delta: delta.content };
          for (const tc of delta.tool_calls ?? []) {
            const idx: number = tc.index ?? pending.size;
            const cur = pending.get(idx) ?? { id: tc.id ?? `call_${idx}`, name: '', args: '' };
            if (tc.id) cur.id = tc.id;
            if (tc.function?.name) cur.name += tc.function.name;
            if (tc.function?.arguments) cur.args += typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments);
            pending.set(idx, cur);
          }
        }
      }
    } catch (e) {
      if (input.signal?.aborted) return;
      throw new LlmUnavailableError((e as Error).message);
    } finally {
      clearTimeout(timeout);
    }
    for (const [, c] of [...pending.entries()].sort((a, b) => a[0] - b[0])) {
      const call: ToolCall = { id: c.id, name: c.name, arguments: c.args || '{}' };
      yield { type: 'tool_call', call };
    }
    yield { type: 'done', usage };
  }
}
