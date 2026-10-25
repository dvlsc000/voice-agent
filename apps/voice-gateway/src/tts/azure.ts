import { TtsError, type TextToSpeech } from './types';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Azure AI Speech neural TTS (choose an EU region). Used for Croatian voices (e.g. hr-HR-GabrijelaNeural).
 * Output format raw-8khz-8bit-mono-mulaw matches Twilio media streams directly.
 */
export class AzureTts implements TextToSpeech {
  readonly id = 'azure';
  constructor(private readonly opts: { key: string; region: string; voices: Partial<Record<'en' | 'hr', string>>; fetch?: typeof fetch }) {}

  ssml(text: string, language: 'en' | 'hr', voice: string, speed = 1): string {
    const lang = language === 'hr' ? 'hr-HR' : 'en-IE';
    const rate = speed === 1 ? '' : ` rate="${Math.round((speed - 1) * 100)}%"`;
    return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}"><voice name="${voice}"><prosody${rate}>${esc(text)}</prosody></voice></speak>`;
  }

  async *synthesize(text: string, o: { language: 'en' | 'hr'; voice?: string; speed?: number; signal?: AbortSignal }): AsyncIterable<Buffer> {
    const voice = o.voice ?? this.opts.voices[o.language];
    if (!voice) throw new TtsError(`No Azure voice configured for ${o.language}`);
    const res = await (this.opts.fetch ?? fetch)(`https://${this.opts.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      signal: o.signal,
      headers: {
        'Ocp-Apim-Subscription-Key': this.opts.key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'raw-8khz-8bit-mono-mulaw',
        'User-Agent': 'voice-gateway',
      },
      body: this.ssml(text, o.language, voice, o.speed),
    });
    if (!res.ok || !res.body) throw new TtsError(`Azure TTS ${res.status}`);
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) yield Buffer.from(chunk);
  }
}

/** Route by language: e.g. Deepgram Aura for English, Azure for Croatian. */
export class LanguageRoutedTts implements TextToSpeech {
  readonly id = 'routed';
  constructor(private readonly byLanguage: Record<'en' | 'hr', TextToSpeech>) {}
  synthesize(text: string, o: { language: 'en' | 'hr'; voice?: string; speed?: number; signal?: AbortSignal }): AsyncIterable<Buffer> {
    return this.byLanguage[o.language].synthesize(text, o);
  }
}
