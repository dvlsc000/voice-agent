import type { Language } from '../i18n/locale';
import type { IndustryTemplate } from '../templates/schema';

function normalise(s: string): string {
  return s.toLowerCase().normalize('NFC').replace(/[’']/g, "'").replace(/\s+/g, ' ');
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word/phrase match, Unicode-aware ("pain" must not match "paint"; works for č/ć/š/ž). */
function containsPhrase(text: string, phrase: string): boolean {
  // A trailing "*" makes the last word a prefix (stem), for inflected languages: "otek*" matches "oteklinu".
  const isStem = phrase.endsWith('*');
  const body = escapeRe(isStem ? phrase.slice(0, -1) : phrase);
  const tail = isStem ? '' : '(?=$|[^\\p{L}\\p{N}])';
  return new RegExp(`(^|[^\\p{L}\\p{N}])${body}${tail}`, 'u').test(text);
}

/**
 * Deterministic safety net that runs on every final caller transcript, independent of the LLM.
 * If a rule fires, the gateway injects the rule's script/action even if the model missed it.
 * Keyword matching over-triggers by design: a false positive costs a callback, a false negative could cost much more.
 */
export function detectEscalation(
  utterance: string,
  template: IndustryTemplate,
  lang: Language,
): { ruleId: string; action: IndustryTemplate['escalation'][number]['action'] } | null {
  const text = normalise(utterance);
  // Priority: emergency first, then the template's declared order.
  const ordered = [...template.escalation].sort(
    (a, b) => Number(b.action === 'emergency_instructions') - Number(a.action === 'emergency_instructions'),
  );
  for (const rule of ordered) {
    const words = [...rule.keywords[lang], ...(lang === 'en' ? [] : rule.keywords.en)];
    if (words.some((k) => containsPhrase(text, normalise(k)))) return { ruleId: rule.id, action: rule.action };
  }
  return null;
}
