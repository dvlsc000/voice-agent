import { createServer, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  ConversationEngine,
  ToolExecutor,
  finalizeCall,
  loadCallRuntime,
  startInboundCall,
  type BookingService,
  type CallRuntime,
  type CallSession,
  type ChatModel,
  type Db,
  type ToolResult,
} from '@vp/server';
import { toE164 } from '@vp/core';
import { AudioCallSession, type AudioSink, type SessionTimings } from '../call/session';
import type { SpeechToText, SttStream, TranscriptEvent } from '../stt/types';
import type { TextToSpeech } from '../tts/types';
import type { DemoBusiness } from './demo-businesses';

/**
 * Local test bench: talk to a demo business's assistant from a browser, by typing or with a microphone.
 * Everything behind the phone line is the production code path — call routing, the published assistant,
 * the conversation engine, tool authorization, the booking engine and the database. Only the phone network
 * is replaced: the browser sends 8 kHz mu-law audio in the same shape Twilio media streams use.
 *
 * Meant to run on a developer's machine bound to 127.0.0.1 against the DEVELOPMENT database.
 */
export interface PlaygroundDeps {
  db: Db;
  booking: BookingService;
  model: ChatModel;
  businesses: DemoBusiness[];
  /** null when no speech keys are configured: typed chat still works. */
  voice: { stt: SpeechToText; tts: TextToSpeech; languages: Array<'en' | 'hr'> } | null;
  modelLabel: string;
  timings?: Partial<SessionTimings>;
  log?: (event: string, data?: Record<string, unknown>) => void;
}

type Send = (m: Record<string, unknown>) => void;

/** Tool executor that also reports each action, its arguments and result to the browser's debug panel. */
class ReportingToolExecutor extends ToolExecutor {
  constructor(deps: ConstructorParameters<typeof ToolExecutor>[0], private readonly report: Send) {
    super(deps);
  }
  override async execute(session: CallSession, name: string, rawArgs: unknown, toolCallId?: string): Promise<ToolResult> {
    const started = Date.now();
    const r = await super.execute(session, name, rawArgs, toolCallId);
    this.report({ type: 'tool', name, args: rawArgs, ok: r.ok, data: r.data ?? null, guidance: r.guidance ?? null, action: r.action ?? null, ms: Date.now() - started });
    return r;
  }
}

function page(): string {
  return readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

export function createPlayground(deps: PlaygroundDeps): Server {
  const log = deps.log ?? ((e, d) => console.log(JSON.stringify({ at: new Date().toISOString(), event: e, ...d })));
  const html = page();

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(html);
    }
    if (req.method === 'GET' && url.pathname === '/api/setup') {
      return json(res, 200, {
        model: deps.modelLabel,
        voice: deps.voice ? { languages: deps.voice.languages } : null,
        businesses: deps.businesses.map((b) => ({ slug: b.slug, name: b.name, industry: b.industry, country: b.country, language: b.language, timezone: b.timezone, facts: b.facts })),
      });
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    // Same-origin only: another site open in the browser must not be able to drive the playground.
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) return socket.destroy();
    if (url.pathname !== '/ws/chat' && url.pathname !== '/ws/voice') return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => void open(ws, url).catch((e) => {
      log('playground.error', { message: (e as Error).message });
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'error', message: (e as Error).message }));
        ws.close();
      }
    }));
  });

  /** Routes the "call" exactly like a real inbound call to the business's number. */
  async function startCall(ws: WebSocket, url: URL, send: Send): Promise<{ business: DemoBusiness; callId: string; rt: CallRuntime; tools: ToolExecutor } | null> {
    const business = deps.businesses.find((b) => b.slug === url.searchParams.get('business'));
    if (!business) {
      send({ type: 'error', message: 'Unknown demo business.' });
      ws.close();
      return null;
    }
    const rawCaller = url.searchParams.get('caller') ?? '';
    const caller = rawCaller ? toE164(rawCaller, business.country) : null;
    const decision = await startInboundCall(deps.db, { provider: 'playground', providerCallId: `PG${randomUUID().replace(/-/g, '')}`, toE164: business.number, fromE164: caller });
    if (decision.type !== 'agent') {
      send({ type: 'error', message: `This business would not be answered by the assistant (${decision.type}: ${'reason' in decision ? decision.reason : ''}).` });
      ws.close();
      return null;
    }
    const rt = await loadCallRuntime(deps.db, decision.callId, decision.serviceLevel);
    const tools = new ReportingToolExecutor({ db: deps.db, booking: deps.booking }, send);
    send({ type: 'started', callId: decision.callId, business: business.name, language: rt.settings.primaryLanguage, callerId: caller, tools: rt.agent.tools });
    log('playground.call_started', { callId: decision.callId, business: business.slug, mode: url.pathname });
    return { business, callId: decision.callId, rt, tools };
  }

  async function open(ws: WebSocket, url: URL): Promise<void> {
    const send: Send = (m) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));
    if (url.pathname === '/ws/voice') {
      if (!deps.voice) {
        send({ type: 'error', message: 'Voice needs DEEPGRAM_API_KEY in .env.playground.' });
        return ws.close();
      }
      // Buffer browser messages that arrive while the call is being set up.
      const early: unknown[] = [];
      const earlyHandler = (raw: unknown) => early.push(raw);
      ws.on('message', earlyHandler);
      const call = await startCall(ws, url, send);
      ws.off('message', earlyHandler);
      if (!call) return;
      if (!deps.voice.languages.includes(call.rt.settings.primaryLanguage)) {
        send({ type: 'error', message: 'No voice is configured for this language. Croatian needs AZURE_SPEECH_KEY in .env.playground.' });
        return ws.close();
      }
      await runVoice(ws, call, send);
      for (const raw of early) ws.emit('message', raw);
      return;
    }
    const call = await startCall(ws, url, send);
    if (call) runChat(ws, call, send);
  }

  function runChat(ws: WebSocket, call: NonNullable<Awaited<ReturnType<typeof startCall>>>, send: Send): void {
    const { rt, callId } = call;
    const engine = new ConversationEngine({ model: deps.model, tools: call.tools }, rt.session, rt.agent, rt.template);
    const startedAt = Date.now();
    let busy = false;
    let ended: 'caller' | 'agent' | 'error' | null = null;
    send({ type: 'agent', text: engine.greeting() });
    send({ type: 'ready' });

    const finish = async (by: 'caller' | 'agent' | 'error') => {
      if (ended) return;
      ended = by;
      await finalizeCall(deps.db, callId, {
        durationSec: (Date.now() - startedAt) / 1000, endedBy: by, outcome: engine.outcome(), transcript: engine.transcript,
        transcriptsEnabled: rt.settings.transcriptsEnabled, escalationRuleId: engine.escalationRuleId, language: rt.settings.primaryLanguage, country: rt.country,
      });
      send({ type: 'ended', by, outcome: engine.outcome(), callId });
      log('playground.call_ended', { callId, by, outcome: engine.outcome() });
    };

    ws.on('message', async (raw) => {
      let m: { type?: string; text?: string };
      try {
        m = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (m.type === 'hangup') {
        await finish('caller').catch((e) => log('playground.finalize_error', { message: (e as Error).message }));
        return ws.close();
      }
      if (m.type !== 'say' || !m.text?.trim() || busy || ended) return;
      busy = true;
      const t0 = Date.now();
      let first = true;
      try {
        for await (const out of engine.respond(m.text.slice(0, 1000))) {
          if (out.type === 'say') {
            if (first) send({ type: 'latency', ms: Date.now() - t0, what: 'first sentence' });
            first = false;
            send({ type: 'agent', text: out.text });
          } else if (out.type === 'event') {
            if (out.name !== 'tool') send({ type: 'event', name: out.name, data: out.data ?? null });
            if (out.name === 'llm.failed') send({ type: 'note', text: 'On a real call the caller would now be transferred to the business.' });
          } else if (out.type === 'action') {
            send({ type: 'action', action: out.action });
            await finish('agent');
            break;
          }
        }
      } catch (e) {
        send({ type: 'error', message: (e as Error).message });
      } finally {
        busy = false;
        send({ type: 'ready' });
      }
    });
    ws.on('close', () => void finish('caller').catch((e) => log('playground.finalize_error', { message: (e as Error).message })));
  }

  async function runVoice(ws: WebSocket, call: NonNullable<Awaited<ReturnType<typeof startCall>>>, send: Send): Promise<void> {
    const { rt, callId } = call;
    const voice = deps.voice!;
    const startedAt = Date.now();
    const inner = await voice.stt.open({ language: rt.settings.primaryLanguage, keyterms: rt.keyterms });
    const stt = teeStt(inner, (e) => send({ type: 'stt', text: e.text, final: e.isFinal, endOfTurn: e.speechFinal }));
    const tts: TextToSpeech = {
      id: `${voice.tts.id}+playground`,
      synthesize: (text, o) => {
        send({ type: 'agent', text });
        return voice.tts.synthesize(text, o);
      },
    };
    const sink: AudioSink = {
      sendAudio: (b) => send({ type: 'media', payload: b.toString('base64') }),
      mark: (name) => send({ type: 'mark', name }),
      clear: () => send({ type: 'clear' }),
    };
    const engine = new ConversationEngine({ model: deps.model, tools: call.tools }, rt.session, rt.agent, rt.template);
    let finalized = false;
    const logFinalize = (e: unknown) => log('playground.finalize_error', { message: (e as Error).message });
    const session: AudioCallSession = new AudioCallSession(engine, stt, tts, sink, {
      // The session closes itself right after these return; finalize after that, then close the socket.
      transfer: async (target) => {
        send({ type: 'action', action: { type: 'transfer', target } });
        setTimeout(() => void finish().catch(logFinalize).finally(() => ws.close()), 300);
      },
      hangup: async () => {
        send({ type: 'action', action: { type: 'hang_up' } });
        setTimeout(() => void finish().catch(logFinalize).finally(() => ws.close()), 300);
      },
    }, {
      fallbackPhone: rt.fallbackPhone,
      voice: rt.settings.voice.voiceId === 'unassigned' ? undefined : rt.settings.voice.voiceId,
      speed: rt.settings.voice.speed,
      timings: { maxCallMs: rt.settings.maxCallDurationSec * 1000, ...deps.timings },
      log: (event, data) => {
        if (event === 'turn.latency') send({ type: 'latency', ms: data?.ms, what: 'end of your speech → first audio' });
        else if (event !== 'tool') send({ type: 'event', name: event, data: data ?? null });
      },
    });

    // eslint-disable-next-line prefer-const
    let finish: () => Promise<void>;
    finish = async () => {
      if (finalized) return;
      finalized = true;
      await session.close('caller');
      await finalizeCall(deps.db, callId, {
        durationSec: (Date.now() - startedAt) / 1000, endedBy: session.endedBy ?? 'caller', outcome: engine.outcome(), transcript: engine.transcript,
        transcriptsEnabled: rt.settings.transcriptsEnabled, escalationRuleId: engine.escalationRuleId, language: rt.settings.primaryLanguage, country: rt.country,
      });
      const lat = session.metrics.responseLatencies;
      send({ type: 'ended', by: session.endedBy ?? 'caller', outcome: engine.outcome(), callId, medianLatencyMs: lat.length ? lat.slice().sort((a, b) => a - b)[Math.floor(lat.length / 2)] : null, bargeIns: session.metrics.bargeIns });
      log('playground.call_ended', { callId, outcome: engine.outcome(), turns: lat.length });
    };

    ws.on('message', (raw) => {
      let m: { event?: string; payload?: string; name?: string };
      try {
        m = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (m.event === 'media' && m.payload) session.receiveAudio(Buffer.from(m.payload, 'base64'));
      else if (m.event === 'mark' && m.name) session.onMark(m.name);
      else if (m.event === 'stop') void finish().catch((e) => log('playground.finalize_error', { message: (e as Error).message }));
    });
    ws.on('close', () => void finish().catch((e) => log('playground.finalize_error', { message: (e as Error).message })));
    send({ type: 'ready' });
    await session.start();
  }

  return server;
}

/** Pass speech-recognition events through to the call session, and copy them to the browser. */
function teeStt(inner: SttStream, report: (e: TranscriptEvent) => void): SttStream {
  return {
    sendAudio: (b) => inner.sendAudio(b),
    close: () => inner.close(),
    onTranscript: (cb) => inner.onTranscript((e) => {
      report(e);
      cb(e);
    }),
    onSpeechStarted: (cb) => inner.onSpeechStarted(cb),
    onUtteranceEnd: (cb) => inner.onUtteranceEnd(cb),
    onError: (cb) => inner.onError(cb),
  };
}
