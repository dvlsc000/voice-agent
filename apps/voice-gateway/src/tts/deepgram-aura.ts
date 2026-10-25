import { TtsError, type TextToSpeech } from './types';

/** Deepgram Aura TTS (EU endpoint), streamed as raw 8 kHz mu-law. English voices. */
export class DeepgramAuraTts implements TextToSpeech {
  readonly id = 'deepgram-aura';
  constructor(private readonly opts: { apiKey: string; host?: string; defaultVoice: string; fetch?: typeof fetch }) {}

  async *synthesize(text: string, o: { language: 'en' | 'hr'; voice?: string; signal?: AbortSignal }): AsyncIterable<Buffer> {
    const p = new URLSearchParams({ model: o.voice ?? this.opts.defaultVoice, encoding: 'mulaw', sample_rate: '8000', container: 'none' });
    const res = await (this.opts.fetch ?? fetch)(`https://${this.opts.host ?? 'api.eu.deepgram.com'}/v1/speak?${p}`, {
      method: 'POST',
      signal: o.signal,
      headers: { authorization: `Token ${this.opts.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok || !res.body) throw new TtsError(`Deepgram TTS ${res.status}`);
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) yield Buffer.from(chunk);
  }
}
