import type { ConversationEngine, EngineOutput } from '@vp/server';
import type { SttStream, TranscriptEvent } from '../stt/types';
import type { TextToSpeech } from '../tts/types';

/** Where agent audio goes (Twilio media stream in production, a recorder in tests). */
export interface AudioSink {
  sendAudio(mulaw: Buffer): void;
  mark(name: string): void;
  clear(): void;
}

export interface CallActions {
  transfer(target: string): Promise<void>;
  hangup(): Promise<void>;
}

export interface SessionTimings {
  silenceRepromptMs: number;
  maxSilenceReprompts: number;
  maxCallMs: number;
  /** Minimum words in an interim transcript before we treat caller speech as a barge-in. */
  bargeInMinWords: number;
}

export const DEFAULT_TIMINGS: SessionTimings = { silenceRepromptMs: 9000, maxSilenceReprompts: 2, maxCallMs: 15 * 60_000, bargeInMinWords: 2 };

const LINES = {
  en: {
    stillThere: 'Are you still there?',
    goodbyeSilence: "I'll let you go for now. Feel free to call back any time. Goodbye.",
    timeUp: "I'm sorry, I need to wrap up this call now. Please call back if there's anything else. Goodbye.",
    sttDown: "Sorry, I'm having trouble hearing you.",
    connecting: 'Let me put you through to the team.',
    callBack: 'Please call back a little later. Goodbye.',
  },
  hr: {
    stillThere: 'Jeste li još tu?',
    goodbyeSilence: 'Sada ću završiti poziv. Slobodno nazovite ponovno. Doviđenja.',
    timeUp: 'Oprostite, moram završiti ovaj poziv. Nazovite ponovno ako trebate još nešto. Doviđenja.',
    sttDown: 'Oprostite, imam poteškoća sa zvukom.',
    connecting: 'Spajam vas s timom.',
    callBack: 'Molimo nazovite malo kasnije. Doviđenja.',
  },
} as const;

export interface SessionMetrics {
  turns: number;
  bargeIns: number;
  /** End of caller speech → first agent audio sent, per turn (ms). */
  responseLatencies: number[];
  ttsFailures: number;
}

/**
 * Bridges telephony audio to the conversation engine.
 * - End of turn = speech_final from STT (or UtteranceEnd as a backup on noisy lines).
 * - Barge-in: caller speech while the agent is talking clears queued audio and cancels generation.
 * - Silence: re-prompt, then end politely. Hard cap on call length.
 * - Fallbacks: STT/LLM/TTS failure → transfer to the business's fallback number, else ask to call back.
 */
export class AudioCallSession {
  readonly metrics: SessionMetrics = { turns: 0, bargeIns: 0, responseLatencies: [], ttsFailures: 0 };
  endedBy: 'caller' | 'agent' | 'error' | 'timeout' | null = null;
  private utterance = '';
  private generation: AbortController | null = null;
  private turnChain: Promise<void> = Promise.resolve();
  private pendingMarks = new Map<string, string>(); // mark name → sentence text
  private spokenThisTurn: string[] = [];
  private markSeq = 0;
  private silenceTimer: NodeJS.Timeout | null = null;
  private silenceReprompts = 0;
  private maxTimer: NodeJS.Timeout | null = null;
  private allPlayed: Array<() => void> = [];
  private closed = false;
  private readonly t: SessionTimings;
  private readonly lines: (typeof LINES)['en'] | (typeof LINES)['hr'];

  constructor(
    private readonly engine: ConversationEngine,
    private readonly stt: SttStream,
    private readonly tts: TextToSpeech,
    private readonly sink: AudioSink,
    private readonly actions: CallActions,
    private readonly opts: { fallbackPhone: string | null; voice?: string; speed?: number; timings?: Partial<SessionTimings>; log?: (event: string, data?: Record<string, unknown>) => void },
  ) {
    this.t = { ...DEFAULT_TIMINGS, ...opts.timings };
    this.lines = LINES[engine.language];
  }

  private log(event: string, data?: Record<string, unknown>): void {
    this.opts.log?.(event, data);
  }

  get agentSpeaking(): boolean {
    return this.pendingMarks.size > 0;
  }

  async start(): Promise<void> {
    this.stt.onTranscript((e) => this.onTranscript(e));
    this.stt.onSpeechStarted(() => this.cancelSilence());
    this.stt.onUtteranceEnd(() => this.endOfTurn());
    this.stt.onError((e) => void this.fail('stt', e));
    this.maxTimer = setTimeout(() => void this.timeUp(), this.t.maxCallMs);
    await this.speak(this.engine.greeting(), new AbortController().signal);
    if (this.metrics.ttsFailures > 0) {
      // Can't even greet: don't leave the caller in silence.
      await this.handOffOrEnd(false);
      return;
    }
    this.armSilenceWhenDone();
  }

  /** Caller audio from the telephony stream. */
  receiveAudio(mulaw: Buffer): void {
    if (!this.closed) this.stt.sendAudio(mulaw);
  }

  /** Twilio echoes a mark when the audio before it has finished playing (or was cleared). */
  onMark(name: string): void {
    const text = this.pendingMarks.get(name);
    if (text === undefined) return;
    this.pendingMarks.delete(name);
    this.spokenThisTurn.push(text);
    if (this.pendingMarks.size === 0) for (const cb of this.allPlayed.splice(0)) cb();
  }

  private onTranscript(e: TranscriptEvent): void {
    if (this.closed) return;
    if (e.text) this.cancelSilence();
    if (!e.isFinal) {
      const words = e.text.trim().split(/\s+/).filter(Boolean).length;
      if (this.agentSpeaking && words >= this.t.bargeInMinWords) this.bargeIn();
      return;
    }
    if (e.text) this.utterance += (this.utterance ? ' ' : '') + e.text.trim();
    if (e.speechFinal) this.endOfTurn();
  }

  private bargeIn(): void {
    this.metrics.bargeIns++;
    this.log('barge_in');
    this.generation?.abort();
    this.sink.clear(); // Twilio returns marks for cleared audio; unplayed sentences must not count as spoken
    this.pendingMarks.clear();
    for (const cb of this.allPlayed.splice(0)) cb();
    this.engine.truncateLastAgentMessage(this.spokenThisTurn.join(' '));
  }

  private endOfTurn(): void {
    const text = this.utterance.trim();
    this.utterance = '';
    if (!text || this.closed) return;
    const heardAt = Date.now();
    if (this.agentSpeaking) this.bargeIn();
    this.generation?.abort();
    const controller = new AbortController();
    this.generation = controller;
    this.turnChain = this.turnChain.then(() => this.runTurn(text, heardAt, controller.signal)).catch((e) => this.fail('turn', e as Error));
  }

  private async runTurn(text: string, heardAt: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted || this.closed) return;
    this.metrics.turns++;
    this.spokenThisTurn = [];
    let firstAudio = true;
    for await (const out of this.engine.respond(text, signal) as AsyncGenerator<EngineOutput>) {
      if (signal.aborted || this.closed) return;
      if (out.type === 'say') {
        await this.speak(out.text, signal, () => {
          if (firstAudio) {
            firstAudio = false;
            const ms = Date.now() - heardAt;
            this.metrics.responseLatencies.push(ms);
            this.log('turn.latency', { ms });
          }
        });
      } else if (out.type === 'action') {
        await this.waitForPlayback();
        if (out.action.type === 'transfer') await this.transfer(out.action.target);
        else await this.end('agent');
        return;
      } else if (out.type === 'event') {
        this.log(out.name, out.data);
        if (out.name === 'llm.failed') {
          await this.handOffOrEnd();
          return;
        }
      }
    }
    this.armSilenceWhenDone();
  }

  private async speak(text: string, signal: AbortSignal, onFirstAudio?: () => void): Promise<void> {
    if (!text || signal.aborted || this.closed) return;
    let sent = false;
    try {
      for await (const chunk of this.tts.synthesize(text, { language: this.engine.language, voice: this.opts.voice, speed: this.opts.speed, signal })) {
        if (signal.aborted || this.closed) return;
        if (!sent) onFirstAudio?.();
        sent = true;
        this.sink.sendAudio(chunk);
      }
    } catch (e) {
      if (signal.aborted) return;
      this.metrics.ttsFailures++;
      this.log('tts.error', { message: (e as Error).message });
      if (this.metrics.ttsFailures >= 2) await this.handOffOrEnd(false);
      return;
    }
    if (!sent) return;
    const name = `m${++this.markSeq}`;
    this.pendingMarks.set(name, text);
    this.sink.mark(name);
  }

  private waitForPlayback(): Promise<void> {
    if (!this.agentSpeaking) return Promise.resolve();
    return new Promise((resolve) => {
      const guard = setTimeout(resolve, 20_000); // never hang forever if a mark is lost
      this.allPlayed.push(() => {
        clearTimeout(guard);
        resolve();
      });
    });
  }

  private armSilenceWhenDone(): void {
    void this.waitForPlayback().then(() => {
      if (this.closed) return;
      this.cancelSilence();
      this.silenceTimer = setTimeout(() => void this.onSilence(), this.t.silenceRepromptMs);
    });
  }

  private cancelSilence(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
  }

  private async onSilence(): Promise<void> {
    if (this.closed || this.agentSpeaking) return;
    if (this.silenceReprompts >= this.t.maxSilenceReprompts) {
      await this.speak(this.lines.goodbyeSilence, new AbortController().signal);
      await this.waitForPlayback();
      await this.end('timeout');
      return;
    }
    this.silenceReprompts++;
    await this.speak(this.lines.stillThere, new AbortController().signal);
    this.armSilenceWhenDone();
  }

  private async timeUp(): Promise<void> {
    if (this.closed) return;
    this.generation?.abort();
    if (this.agentSpeaking) this.sink.clear();
    this.pendingMarks.clear();
    await this.speak(this.lines.timeUp, new AbortController().signal);
    await this.waitForPlayback();
    await this.end('timeout');
  }

  private async transfer(target: string): Promise<void> {
    this.engine.markOutcome('transferred');
    try {
      await this.actions.transfer(target);
      await this.close('agent');
    } catch (e) {
      this.log('transfer.failed', { message: (e as Error).message });
      // Transfer failure recovery: keep the caller and offer a message instead.
      this.armSilenceWhenDone();
    }
  }

  /** Something broke: get the caller to a human if we can, otherwise ask them to call back. */
  private async handOffOrEnd(canSpeak = true): Promise<void> {
    if (this.closed) return;
    if (this.opts.fallbackPhone) {
      if (canSpeak) {
        await this.speak(this.lines.connecting, new AbortController().signal);
        await this.waitForPlayback();
      }
      await this.transfer(this.opts.fallbackPhone);
      return;
    }
    if (canSpeak) {
      await this.speak(this.lines.callBack, new AbortController().signal);
      await this.waitForPlayback();
    }
    this.engine.markOutcome('failed');
    await this.end('error');
  }

  private async fail(component: string, e: Error): Promise<void> {
    if (this.closed) return;
    this.log(`${component}.error`, { message: e.message });
    if (component === 'stt') {
      await this.speak(this.lines.sttDown, new AbortController().signal);
      await this.waitForPlayback();
    }
    await this.handOffOrEnd(true); // TTS still works here; TTS failures take the silent path in speak()
  }

  private async end(by: 'agent' | 'timeout' | 'error'): Promise<void> {
    if (this.closed) return;
    try {
      await this.actions.hangup();
    } finally {
      await this.close(by);
    }
  }

  /** Called on our own hang-up/transfer, or when the media stream stops (caller hung up). */
  async close(by: 'caller' | 'agent' | 'error' | 'timeout' = 'caller'): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.endedBy = by;
    this.generation?.abort();
    this.cancelSilence();
    if (this.maxTimer) clearTimeout(this.maxTimer);
    for (const cb of this.allPlayed.splice(0)) cb();
    await this.stt.close().catch(() => undefined);
  }
}
