import WebSocket from 'ws';
import type { SpeechToText, SttStream, TranscriptEvent } from './types';

/**
 * Deepgram streaming STT over WebSocket. Default host is the EU endpoint (processing stays in the EU).
 * Audio: Twilio's 8 kHz mu-law, passed through without transcoding.
 */
export class DeepgramStt implements SpeechToText {
  readonly id = 'deepgram';
  constructor(
    private readonly opts: { apiKey: string; host?: string; model?: string; modelByLanguage?: Partial<Record<'en' | 'hr', string>>; endpointingMs?: number; WebSocketImpl?: typeof WebSocket },
  ) {}

  buildUrl(language: 'en' | 'hr', keyterms: string[] = []): string {
    const p = new URLSearchParams({
      model: this.opts.modelByLanguage?.[language] ?? this.opts.model ?? 'nova-3',
      language,
      encoding: 'mulaw',
      sample_rate: '8000',
      channels: '1',
      interim_results: 'true',
      endpointing: String(this.opts.endpointingMs ?? 300),
      utterance_end_ms: '1000',
      vad_events: 'true',
      punctuate: 'true',
      smart_format: 'true',
    });
    for (const k of keyterms.slice(0, 50)) p.append('keyterm', k);
    return `wss://${this.opts.host ?? 'api.eu.deepgram.com'}/v1/listen?${p}`;
  }

  open(o: { language: 'en' | 'hr'; keyterms?: string[] }): Promise<SttStream> {
    const WS = this.opts.WebSocketImpl ?? WebSocket;
    const ws = new WS(this.buildUrl(o.language, o.keyterms), { headers: { Authorization: `Token ${this.opts.apiKey}` } });
    const transcriptCbs: Array<(e: TranscriptEvent) => void> = [];
    const speechCbs: Array<() => void> = [];
    const endCbs: Array<() => void> = [];
    const errCbs: Array<(e: Error) => void> = [];
    const queue: Buffer[] = [];
    let keepAlive: NodeJS.Timeout | undefined;

    ws.on('message', (raw) => {
      let m: any;
      try {
        m = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (m.type === 'Results') {
        const text: string = m.channel?.alternatives?.[0]?.transcript ?? '';
        const e = { text, isFinal: !!m.is_final, speechFinal: !!m.speech_final };
        if (text || e.speechFinal) for (const cb of transcriptCbs) cb(e);
      } else if (m.type === 'SpeechStarted') {
        for (const cb of speechCbs) cb();
      } else if (m.type === 'UtteranceEnd') {
        for (const cb of endCbs) cb();
      }
    });
    ws.on('error', (e) => errCbs.forEach((cb) => cb(e as Error)));
    ws.on('close', (code) => {
      if (keepAlive) clearInterval(keepAlive);
      if (code !== 1000) errCbs.forEach((cb) => cb(new Error(`STT stream closed (${code})`)));
    });

    const stream: SttStream = {
      sendAudio(buf) {
        if (ws.readyState === WS.OPEN) ws.send(buf);
        else if (ws.readyState === WS.CONNECTING && queue.length < 250) queue.push(buf);
      },
      async close() {
        if (keepAlive) clearInterval(keepAlive);
        if (ws.readyState === WS.OPEN) ws.send(JSON.stringify({ type: 'CloseStream' }));
        setTimeout(() => ws.close(1000), 500).unref();
      },
      onTranscript: (cb) => void transcriptCbs.push(cb),
      onSpeechStarted: (cb) => void speechCbs.push(cb),
      onUtteranceEnd: (cb) => void endCbs.push(cb),
      onError: (cb) => void errCbs.push(cb),
    };

    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('STT connect timeout')), 5000);
      ws.once('open', () => {
        clearTimeout(t);
        for (const b of queue.splice(0)) ws.send(b);
        keepAlive = setInterval(() => ws.readyState === WS.OPEN && ws.send(JSON.stringify({ type: 'KeepAlive' })), 8000);
        keepAlive.unref();
        resolve(stream);
      });
      ws.once('error', (e) => {
        clearTimeout(t);
        reject(e);
      });
    });
  }
}
