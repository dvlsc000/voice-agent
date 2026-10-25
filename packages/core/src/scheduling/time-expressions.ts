import { localToInstant } from './availability.js';

export type DayPart = 'morning' | 'afternoon' | 'evening' | 'any';

/** Local wall-clock windows used when a caller says "tomorrow afternoon" / "sutra popodne". */
export const DAY_PART_WINDOWS: Record<DayPart, { start: string; end: string }> = {
  morning: { start: '00:00', end: '12:00' },
  afternoon: { start: '12:00', end: '17:00' },
  evening: { start: '17:00', end: '24:00' },
  any: { start: '00:00', end: '24:00' },
};

export function dayPartWindow(dateISO: string, part: DayPart, zone: string): { from: string; to: string } {
  const w = DAY_PART_WINDOWS[part];
  return {
    from: localToInstant(dateISO, w.start, zone).toUTC().toISO()!,
    to: localToInstant(dateISO, w.end, zone).toUTC().toISO()!,
  };
}

const EN_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const HR_NUMBERS: Record<string, number> = {
  jedan: 1, jedna: 1, dva: 2, dvije: 2, tri: 3, četiri: 4, cetiri: 4, pet: 5, šest: 6, sest: 6, sedam: 7, osam: 8,
  devet: 9, deset: 10, jedanaest: 11, dvanaest: 12,
};

function num(token: string | undefined, table: Record<string, number>): number | undefined {
  if (!token) return undefined;
  if (/^\d{1,2}$/.test(token)) return Number(token);
  return table[token];
}

/**
 * Deterministic interpretation of 12-hour colloquial clock expressions.
 * Returns candidate "HH:mm" values (AM and PM readings); the caller filters by opening hours.
 *
 * Critical locale trap this guards against:
 *   Irish/UK English  "half five"  = 05:30 / 17:30  (half PAST five)
 *   Croatian          "pola pet"   = 04:30 / 16:30  (half TO five), like German "halb fünf"
 */
export function interpretClockExpression(input: string, lang: 'en' | 'hr'): string[] {
  const t = input.trim().toLowerCase().replace(/\s+/g, ' ');
  let hour: number | undefined;
  let minute = 0;
  let m: RegExpMatchArray | null;

  if (lang === 'en') {
    if ((m = t.match(/^half (?:past )?(\w+)$/))) {
      hour = num(m[1], EN_NUMBERS);
      minute = 30;
    } else if ((m = t.match(/^(?:a )?quarter past (\w+)$/))) {
      hour = num(m[1], EN_NUMBERS);
      minute = 15;
    } else if ((m = t.match(/^(?:a )?quarter to (\w+)$/))) {
      const h = num(m[1], EN_NUMBERS);
      hour = h === undefined ? undefined : h === 1 ? 12 : h - 1;
      minute = 45;
    } else if ((m = t.match(/^(\w+)(?: o'?clock)?$/))) {
      hour = num(m[1], EN_NUMBERS);
    }
  } else {
    if ((m = t.match(/^pola (\S+)$/))) {
      const h = num(m[1], HR_NUMBERS);
      hour = h === undefined ? undefined : h === 1 ? 12 : h - 1;
      minute = 30;
    } else if ((m = t.match(/^(\S+) i (?:četvrt|cetvrt)$/))) {
      hour = num(m[1], HR_NUMBERS);
      minute = 15;
    } else if ((m = t.match(/^(?:četvrt|cetvrt) do (\S+)$/))) {
      const h = num(m[1], HR_NUMBERS);
      hour = h === undefined ? undefined : h === 1 ? 12 : h - 1;
      minute = 45;
    } else if ((m = t.match(/^(\S+)(?: sati| sat)?$/))) {
      hour = num(m[1], HR_NUMBERS);
    }
  }
  if (hour === undefined || hour < 1 || hour > 12) return [];
  const mm = String(minute).padStart(2, '0');
  const am = hour === 12 ? 0 : hour;
  const pm = hour === 12 ? 12 : hour + 12;
  return [`${String(am).padStart(2, '0')}:${mm}`, `${String(pm).padStart(2, '0')}:${mm}`];
}
