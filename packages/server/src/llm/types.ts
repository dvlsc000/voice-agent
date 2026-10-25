/** Provider-neutral chat model interface used by the conversation engine and simulations. */
export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface ToolCall {
  id: string;
  name: string;
  arguments: string; // raw JSON text from the model — parsed and validated server-side
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export type LlmEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'done'; usage?: { inputTokens: number; outputTokens: number } };

export interface ChatModel {
  readonly id: string;
  stream(input: { messages: ChatMessage[]; tools: ToolSpec[]; temperature?: number; maxTokens?: number; signal?: AbortSignal }): AsyncIterable<LlmEvent>;
}

export class LlmUnavailableError extends Error {
  override name = 'LlmUnavailableError';
}
