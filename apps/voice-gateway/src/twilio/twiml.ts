const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const LANG = { en: 'en-IE', hr: 'hr-HR' } as const;

/** Connect the call to our media stream. If the stream fails, Twilio continues to the fallback verbs. */
export function connectStreamTwiml(opts: { streamUrl: string; params: Record<string, string>; fallbackE164: string | null; language: 'en' | 'hr' }): string {
  const params = Object.entries(opts.params).map(([k, v]) => `<Parameter name="${esc(k)}" value="${esc(v)}"/>`).join('');
  const fallback = opts.fallbackE164
    ? `<Dial timeout="25">${esc(opts.fallbackE164)}</Dial>`
    : `<Say language="${LANG[opts.language]}">${opts.language === 'hr' ? 'Oprostite, trenutačno ne možemo odgovoriti. Molimo nazovite kasnije.' : "Sorry, we can't take your call right now. Please call back later."}</Say>`;
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="${esc(opts.streamUrl)}">${params}</Stream></Connect>${fallback}</Response>`;
}

export function forwardTwiml(target: string, callerId?: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Dial timeout="25"${callerId ? ` callerId="${esc(callerId)}"` : ''}>${esc(target)}</Dial></Response>`;
}

export function sayAndHangupTwiml(text: string, language: 'en' | 'hr'): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say language="${LANG[language]}">${esc(text)}</Say><Hangup/></Response>`;
}

/** Transfer with a fallback: if the staff phone doesn't answer, record a voicemail instead of dropping the caller. */
export function transferTwiml(target: string, language: 'en' | 'hr', voicemailActionUrl: string): string {
  const noAnswer = language === 'hr' ? 'Nitko se ne javlja. Ostavite poruku nakon signala.' : "Nobody's free right now. Please leave a message after the tone.";
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Dial timeout="20">${esc(target)}</Dial><Say language="${LANG[language]}">${esc(noAnswer)}</Say><Record maxLength="120" playBeep="true" action="${esc(voicemailActionUrl)}"/></Response>`;
}
