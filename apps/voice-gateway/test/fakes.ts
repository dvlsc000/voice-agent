import { BARBERSHOP, compileAgent, toolsForCapabilities, type Capability } from '@vp/core';
import { ConversationEngine, ScriptedChatModel, type CallSession, type ScriptStep, type ToolResult } from '@vp/server';
import type { AudioSink, CallActions } from '../src/call/session';
import type { SttStream, TranscriptEvent } from '../src/stt/types';
import type { TextToSpeech } from '../src/tts/types';

export class FakeStt implements SttStream {
  private t: Array<(e: TranscriptEvent) => void> = [];
  private s: Array<() => void> = [];
  private u: Array<() => void> = [];
  private e: Array<(e: Error) => void> = [];
  audio = 0;
  closed = false;
  sendAudio(): void {
    this.audio++;
  }
  async close(): Promise<void> {
    this.closed = true;
  }
  onTranscript(cb: (e: TranscriptEvent) => void): void {
    this.t.push(cb);
  }
  onSpeechStarted(cb: () => void): void {
    this.s.push(cb);
  }
  onUtteranceEnd(cb: () => void): void {
    this.u.push(cb);
  }
  onError(cb: (e: Error) => void): void {
    this.e.push(cb);
  }
  say(text: string): void {
    for (const cb of this.t) cb({ text, isFinal: true, speechFinal: true });
  }
  interim(text: string): void {
    for (const cb of this.t) cb({ text, isFinal: false, speechFinal: false });
  }
  fail(): void {
    for (const cb of this.e) cb(new Error('socket closed'));
  }
}

export class FakeTts implements TextToSpeech {
  readonly id = 'fake';
  failNext = 0;
  async *synthesize(text: string): AsyncIterable<Buffer> {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('tts down');
    }
    yield Buffer.from(text);
  }
}

/** Records what would be played. Marks are acknowledged as "played" unless `holdMarks` is set. */
export class FakeSink implements AudioSink {
  played: string[] = [];
  clears = 0;
  holdMarks = false;
  heldMarks: string[] = [];
  onMark: (name: string) => void = () => undefined;
  sendAudio(b: Buffer): void {
    this.played.push(b.toString());
  }
  mark(name: string): void {
    if (this.holdMarks) this.heldMarks.push(name);
    else setImmediate(() => this.onMark(name));
  }
  clear(): void {
    this.clears++;
    this.heldMarks = [];
  }
  release(): void {
    for (const m of this.heldMarks.splice(0)) this.onMark(m);
  }
}

export class FakeActions implements CallActions {
  transfers: string[] = [];
  hangups = 0;
  failTransfer = false;
  async transfer(t: string): Promise<void> {
    if (this.failTransfer) throw new Error('busy');
    this.transfers.push(t);
  }
  async hangup(): Promise<void> {
    this.hangups++;
  }
}

export function makeEngine(steps: ScriptStep[], toolResult: ToolResult = { ok: true }, caps: Capability[] = ['reception', 'booking', 'messages', 'human_handoff']) {
  const session: CallSession = {
    ctx: { organizationId: 'org', callId: 'call', agentVersionId: 'v', enabledCapabilities: caps, agentToolAllowlist: toolsForCapabilities(caps), verifiedBookingIds: new Set(), offeredSlots: new Set(), toolCallsSoFar: 0, consequentialCallsSoFar: 0, organizationStatus: 'active' },
    callerIdE164: '+353871234567', timezone: 'Europe/Dublin', language: 'en', verificationAttempts: 0,
  };
  const agent = compileAgent(BARBERSHOP, {
    agentName: 'Nora', primaryLanguage: 'en', additionalLanguages: [], allowLanguageSwitch: false, formality: 'neutral', enabledCapabilities: caps,
    voice: { provider: 'x', voiceId: 'x', speed: 1 }, pronunciations: [], customInstructions: '', maxCallDurationSec: 900, recordingEnabled: false, transcriptsEnabled: true,
  }, { businessName: "Mark's Barbers", timezone: 'Europe/Dublin', factsText: '' });
  const executed: string[] = [];
  const tools = { execute: async (_s: CallSession, name: string) => (executed.push(name), toolResult) } as never;
  return { engine: new ConversationEngine({ model: new ScriptedChatModel(steps), tools }, session, agent, BARBERSHOP), executed };
}

export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
