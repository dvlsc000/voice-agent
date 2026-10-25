import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  ConversationEngine,
  finalizeCall,
  loadCallRuntime,
  startInboundCall,
  type ChatModel,
  type Db,
  type ToolExecutor,
} from '@vp/server';
import type { ServiceLevel } from '@vp/core';
import { AudioCallSession, type AudioSink, type SessionTimings } from './call/session';
import type { SpeechToText } from './stt/types';
import type { TextToSpeech } from './tts/types';
import type { CallControl } from './twilio/call-control';
import { isValidTwilioRequest, streamToken, verifyStreamToken } from './twilio/signature';
import { connectStreamTwiml, forwardTwiml, sayAndHangupTwiml, transferTwiml } from './twilio/twiml';

export interface GatewayDeps {
  db: Db;
  publicBaseUrl: string; // https://voice.example.com
  twilioAuthToken: string;
  streamSecret: string;
  stt: SpeechToText;
  tts: TextToSpeech;
  model: ChatModel;
  tools: ToolExecutor;
  callControl: CallControl;
  timings?: Partial<SessionTimings>;
  log?: (event: string, data?: Record<string, unknown>) => void;
}

const UNAVAILABLE = {
  en: "Sorry, this line isn't taking calls right now. Please try again later.",
  hr: 'Oprostite, ova linija trenutačno ne prima pozive. Pokušajte kasnije.',
};

async function readForm(req: IncomingMessage): Promise<Record<string, string>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 64 * 1024) throw new Error('body too large');
    chunks.push(c as Buffer);
  }
  return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
}

function send(res: ServerResponse, status: number, body: string, type = 'text/xml'): void {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

export function createGateway(deps: GatewayDeps): { server: Server; activeCalls: Map<string, AudioCallSession> } {
  const log = deps.log ?? ((e, d) => console.log(JSON.stringify({ at: new Date().toISOString(), event: e, ...d })));
  const activeCalls = new Map<string, AudioCallSession>();
  const base = deps.publicBaseUrl.replace(/\/$/, '');

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', base);
    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        await deps.db.query('select 1');
        return send(res, 200, JSON.stringify({ ok: true, activeCalls: activeCalls.size }), 'application/json');
      }
      if (req.method !== 'POST' || !url.pathname.startsWith('/twilio/')) return send(res, 404, 'not found', 'text/plain');

      const params = await readForm(req);
      // Signature covers the exact public URL Twilio called, including the query string.
      if (!isValidTwilioRequest(deps.twilioAuthToken, `${base}${url.pathname}${url.search}`, params, req.headers['x-twilio-signature'] as string | undefined)) {
        log('twilio.signature_invalid', { path: url.pathname });
        return send(res, 403, 'forbidden', 'text/plain');
      }

      if (url.pathname === '/twilio/voice') {
        const decision = await startInboundCall(deps.db, { provider: 'twilio', providerCallId: params.CallSid!, toE164: params.To!, fromE164: params.From && params.From !== 'anonymous' ? params.From : null });
        log('call.inbound', { callSid: params.CallSid, decision: decision.type });
        if (decision.type === 'unavailable') return send(res, 200, sayAndHangupTwiml(UNAVAILABLE[decision.language], decision.language));
        if (decision.type === 'forward') return send(res, 200, forwardTwiml(decision.target));
        const wsUrl = `${base.replace(/^http/, 'ws')}/twilio/stream`;
        const fallback = (await deps.db.query(`select fallback_phone_e164 from public.organizations where id = $1`, [decision.organizationId])).rows[0]?.fallback_phone_e164 ?? null;
        return send(
          res,
          200,
          connectStreamTwiml({
            streamUrl: wsUrl,
            params: { callId: decision.callId, token: streamToken(deps.streamSecret, decision.callId), level: decision.serviceLevel },
            fallbackE164: fallback,
            language: decision.language,
          }),
        );
      }

      if (url.pathname === '/twilio/status') {
        // Covers calls whose stream never connected (caller hung up during ringing, forwarded calls).
        if (params.CallStatus === 'completed' || params.CallStatus === 'no-answer' || params.CallStatus === 'failed' || params.CallStatus === 'busy') {
          const { rows } = await deps.db.query(`select c.id, o.country, o.primary_language from public.calls c join public.organizations o on o.id = c.organization_id where c.provider = 'twilio' and c.provider_call_id = $1`, [params.CallSid]);
          if (rows[0] && !activeCalls.has(rows[0].id)) {
            await finalizeCall(deps.db, rows[0].id, {
              durationSec: Number(params.CallDuration ?? 0), endedBy: 'caller', outcome: 'abandoned', transcript: [], transcriptsEnabled: false,
              escalationRuleId: null, language: rows[0].primary_language, country: rows[0].country,
            });
          }
        }
        return send(res, 204, '', 'text/plain');
      }

      if (url.pathname === '/twilio/voicemail') {
        const callId = url.searchParams.get('callId') ?? '';
        const { rows } = await deps.db.query(`select organization_id, from_e164 from public.calls where id = $1 and provider_call_id = $2`, [callId, params.CallSid]);
        if (rows[0] && params.RecordingUrl) {
          const enquiryId = randomUUID();
          await deps.db.query(
            `insert into public.enquiries (id, organization_id, call_id, kind, callback_phone_e164, summary, fields)
             values ($1, $2, $3, 'voicemail', $4, $5, $6)`,
            [enquiryId, rows[0].organization_id, callId, rows[0].from_e164, 'Voicemail left after a transfer was not answered.',
              JSON.stringify({ recording_seconds: params.RecordingDuration ?? '', recording_sid: params.RecordingSid ?? '' })],
          );
          await deps.db.query(`insert into public.jobs (kind, organization_id, payload, dedupe_key) values ('notify_staff_enquiry', $1, $2, $3) on conflict do nothing`, [
            rows[0].organization_id, JSON.stringify({ enquiryId }), `enquiry:${enquiryId}`,
          ]);
        }
        return send(res, 200, '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
      }
      return send(res, 404, 'not found', 'text/plain');
    } catch (e) {
      log('http.error', { path: url.pathname, message: (e as Error).message });
      // Never leave a caller in silence because our server failed.
      if (url.pathname === '/twilio/voice') return send(res, 200, sayAndHangupTwiml(UNAVAILABLE.en, 'en'));
      return send(res, 500, 'error', 'text/plain');
    }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url ?? '/', base).pathname !== '/twilio/stream') return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => handleStream(ws));
  });

  function handleStream(ws: WebSocket): void {
    let session: AudioCallSession | null = null;
    let callId = '';
    let callSid = '';
    let streamSid = '';
    let startedAt = Date.now();
    let finalize: (() => Promise<void>) | null = null;

    const sink: AudioSink = {
      sendAudio: (b) => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ event: 'media', streamSid, media: { payload: b.toString('base64') } })),
      mark: (name) => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ event: 'mark', streamSid, mark: { name } })),
      clear: () => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ event: 'clear', streamSid })),
    };

    ws.on('message', async (raw) => {
      let m: any;
      try {
        m = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (m.event === 'start') {
        streamSid = m.start.streamSid;
        callSid = m.start.callSid;
        callId = m.start.customParameters?.callId ?? '';
        const token = m.start.customParameters?.token ?? '';
        const level = (m.start.customParameters?.level ?? 'full') as ServiceLevel;
        if (!verifyStreamToken(deps.streamSecret, callId, token)) {
          log('stream.token_invalid', { callSid });
          ws.close(1008);
          return;
        }
        startedAt = Date.now();
        try {
          const rt = await loadCallRuntime(deps.db, callId, level);
          const stt = await deps.stt.open({ language: rt.settings.primaryLanguage, keyterms: rt.keyterms });
          const engine = new ConversationEngine({ model: deps.model, tools: deps.tools }, rt.session, rt.agent, rt.template);
          const callLog = (event: string, data?: Record<string, unknown>) => {
            log(event, { callId, ...data });
            void deps.db.query(`insert into public.call_events (organization_id, call_id, type, payload) values ($1, $2, $3, $4)`, [rt.session.ctx.organizationId, callId, event, JSON.stringify(data ?? {})]).catch(() => undefined);
          };
          session = new AudioCallSession(engine, stt, deps.tts, sink, {
            transfer: (target) => deps.callControl.updateTwiml(callSid, transferTwiml(target, rt.settings.primaryLanguage, `${base}/twilio/voicemail?callId=${callId}`)),
            hangup: () => deps.callControl.hangup(callSid),
          }, {
            fallbackPhone: rt.fallbackPhone,
            voice: rt.settings.voice.voiceId === 'unassigned' ? undefined : rt.settings.voice.voiceId,
            speed: rt.settings.voice.speed,
            timings: { maxCallMs: rt.settings.maxCallDurationSec * 1000, ...deps.timings },
            log: callLog,
          });
          activeCalls.set(callId, session);
          finalize = async () => {
            const s = session!;
            await s.close('caller');
            activeCalls.delete(callId);
            await finalizeCall(deps.db, callId, {
              durationSec: (Date.now() - startedAt) / 1000,
              endedBy: s.endedBy ?? 'caller',
              outcome: engine.outcome(),
              transcript: engine.transcript,
              transcriptsEnabled: rt.settings.transcriptsEnabled,
              escalationRuleId: engine.escalationRuleId,
              language: rt.settings.primaryLanguage,
              country: rt.country,
            });
            const lat = s.metrics.responseLatencies;
            if (lat.length) callLog('call.latency_summary', { turns: lat.length, medianMs: lat.slice().sort((a, b) => a - b)[Math.floor(lat.length / 2)], maxMs: Math.max(...lat), bargeIns: s.metrics.bargeIns });
          };
          await session.start();
        } catch (e) {
          log('stream.setup_failed', { callId, message: (e as Error).message });
          ws.close(1011); // Twilio continues with the fallback verbs in the TwiML (dial the business)
        }
      } else if (m.event === 'media' && session && m.media?.track !== 'outbound') {
        session.receiveAudio(Buffer.from(m.media.payload, 'base64'));
      } else if (m.event === 'mark' && session) {
        session.onMark(m.mark?.name);
      } else if (m.event === 'stop') {
        await finalize?.().catch((e) => log('finalize.error', { callId, message: (e as Error).message }));
        finalize = null;
      }
    });
    ws.on('close', () => {
      void finalize?.().catch((e) => log('finalize.error', { callId, message: (e as Error).message }));
      finalize = null;
    });
  }

  return { server, activeCalls };
}
