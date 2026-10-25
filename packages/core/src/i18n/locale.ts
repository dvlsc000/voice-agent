import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max';
import { DateTime } from 'luxon';

export const SUPPORTED_LANGUAGES = ['en', 'hr'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const SUPPORTED_COUNTRIES = ['IE', 'HR'] as const;
export type Country = (typeof SUPPORTED_COUNTRIES)[number];

export const COUNTRY_DEFAULTS: Record<Country, { timezone: string; currency: string; locale: Record<Language, string> }> = {
  IE: { timezone: 'Europe/Dublin', currency: 'EUR', locale: { en: 'en-IE', hr: 'hr-HR' } },
  HR: { timezone: 'Europe/Zagreb', currency: 'EUR', locale: { en: 'en-IE', hr: 'hr-HR' } },
};

/** Normalise a phone number to E.164. Returns null when it is not a plausible number. */
export function toE164(raw: string, defaultCountry: Country): string | null {
  const parsed = parsePhoneNumberFromString(raw, defaultCountry as CountryCode);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

/** Read a number back to a caller digit-group by digit-group, in national format. */
export function phoneForSpeech(e164: string, lang: Language): string {
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed) return e164;
  const national = parsed.formatNational().replace(/[()]/g, '');
  const digitWords: Record<Language, string[]> = {
    en: ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'],
    hr: ['nula', 'jedan', 'dva', 'tri', 'četiri', 'pet', 'šest', 'sedam', 'osam', 'devet'],
  };
  return national
    .split(/\s+/)
    .map((group) =>
      group
        .split('')
        .filter((c) => /\d/.test(c))
        .map((d) => digitWords[lang][Number(d)])
        .join(' '),
    )
    .filter(Boolean)
    .join(', ');
}

/** "Tuesday 4 November at 14:30" / "utorak, 4. studenoga u 14:30" — in the business timezone. */
export function formatSlotForSpeech(isoInstant: string, zone: string, lang: Language): string {
  const dt = DateTime.fromISO(isoInstant, { zone: 'utc' }).setZone(zone).setLocale(lang === 'hr' ? 'hr' : 'en-IE');
  if (lang === 'hr') return `${dt.toFormat('cccc, d. MMMM')} u ${dt.toFormat('H:mm')}`;
  return `${dt.toFormat('cccc d LLLL')} at ${dt.toFormat('h:mm a').toLowerCase()}`;
}

export function formatMoney(amountMinor: number, currency: string, lang: Language): string {
  return new Intl.NumberFormat(lang === 'hr' ? 'hr-HR' : 'en-IE', { style: 'currency', currency }).format(
    amountMinor / 100,
  );
}
