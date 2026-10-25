export interface TranscriptEvent {
  text: string;
  isFinal: boolean; // this segment's text will not change
  speechFinal: boolean; // the speaker paused: end of turn
}

export interface SttStream {
  sendAudio(mulaw8k: Buffer): void;
  close(): Promise<void>;
  onTranscript(cb: (e: TranscriptEvent) => void): void;
  /** Voice activity started — used for barge-in before words are recognised. */
  onSpeechStarted(cb: () => void): void;
  /** Utterance end detected from word timings (backup end-of-turn signal for noisy lines). */
  onUtteranceEnd(cb: () => void): void;
  onError(cb: (e: Error) => void): void;
}

export interface SpeechToText {
  readonly id: string;
  open(opts: { language: 'en' | 'hr'; keyterms?: string[] }): Promise<SttStream>;
}
