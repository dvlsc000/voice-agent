export interface TextToSpeech {
  readonly id: string;
  /** Streams 8 kHz mono mu-law audio (no file header) suitable for Twilio media messages. */
  synthesize(text: string, opts: { language: 'en' | 'hr'; voice?: string; speed?: number; signal?: AbortSignal }): AsyncIterable<Buffer>;
}

export class TtsError extends Error {
  override name = 'TtsError';
}

/** Placeholder for a language with no configured voice: every attempt fails, triggering the session's hand-off. */
export class UnavailableTts implements TextToSpeech {
  readonly id = 'unavailable';
  constructor(private readonly reason: string) {}
  // eslint-disable-next-line require-yield
  async *synthesize(): AsyncIterable<Buffer> {
    throw new TtsError(this.reason);
  }
}
