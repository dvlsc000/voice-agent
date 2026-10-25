import { robotsAllows, safeFetchText, type SafeFetchOptions } from './safe-fetch';

export interface HoursSuggestion {
  weekday: number; // ISO 1–7
  opens: string;
  closes: string;
}
export interface ServiceSuggestion {
  name: string;
  priceMinor: number | null;
  priceIsFrom: boolean;
}
export interface ImportSuggestions {
  sourceUrl: string;
  fetchedAt: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  address: { line: string | null; city: string | null; postcode: string | null } | null;
  hours: HoursSuggestion[];
  services: ServiceSuggestion[];
  description: string | null;
  /** Where each value came from, so a person can check it before anything is used. */
  evidence: Array<{ field: string; source: 'structured_data' | 'page_text' | 'link'; snippet: string }>;
  warnings: string[];
}

const DAY_TOKENS: Array<[RegExp, number]> = [
  [/^(mon(day)?|mo|pon(edjeljak)?|po)\.?$/i, 1],
  [/^(tue(s(day)?)?|tu|uto(rak)?|ut)\.?$/i, 2],
  [/^(wed(nesday)?|we|sri(jeda)?|sr)\.?$/i, 3],
  [/^(thu(r(s(day)?)?)?|th|čet(vrtak)?|cet(vrtak)?|če)\.?$/i, 4],
  [/^(fri(day)?|fr|pet(ak)?|pe)\.?$/i, 5],
  [/^(sat(urday)?|sa|sub(ota)?|su)\.?$/i, 6],
  [/^(sun(day)?|ne(d(jelja)?)?)\.?$/i, 7],
];
const SCHEMA_DAYS: Record<string, number> = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7 };

function dayOf(token: string): number | null {
  const t = token.trim();
  for (const [re, d] of DAY_TOKENS) if (re.test(t)) return d;
  return null;
}

/** "9", "9am", "9:30", "17.30", "5:30pm" → "HH:mm" */
export function normaliseTime(raw: string): string | null {
  const m = raw.trim().toLowerCase().match(/^(\d{1,2})(?:[:.h](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = m[3]?.replace(/\./g, '');
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 24 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function expandDays(from: number, to: number): number[] {
  const out: number[] = [];
  for (let d = from; ; d = (d % 7) + 1) {
    out.push(d);
    if (d === to || out.length > 7) break;
  }
  return out;
}

/** Find opening-hours statements in plain text (English and Croatian). */
export function parseHoursText(text: string): Array<HoursSuggestion & { snippet: string }> {
  const out: Array<HoursSuggestion & { snippet: string }> = [];
  const day = '([A-Za-zčćšžđČĆŠŽĐ]{2,11}\\.?)';
  const time = '(\\d{1,2}(?:[:.h]\\d{2})?\\s*(?:am|pm|a\\.m\\.|p\\.m\\.)?)';
  const re = new RegExp(`${day}(?:\\s*(?:-|–|—|to|do)\\s*${day})?\\s*:?\\s*(?:from\\s+|od\\s+)?${time}\\s*(?:-|–|—|to|do)\\s*${time}`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const d1 = dayOf(m[1]!);
    const d2 = m[2] ? dayOf(m[2]) : d1;
    const opens = normaliseTime(m[3]!);
    let closes = normaliseTime(m[4]!);
    if (d1 === null || d2 === null || !opens || !closes) continue;
    // "9 - 6" with no am/pm: a closing time earlier than opening is almost always pm.
    if (closes <= opens && !/am|pm/i.test(m[4]!)) closes = normaliseTime(`${Number(closes.slice(0, 2)) + 12}:${closes.slice(3)}`) ?? closes;
    if (closes <= opens) continue;
    for (const wd of expandDays(d1, d2)) out.push({ weekday: wd, opens, closes, snippet: m[0].trim() });
  }
  // One entry per weekday: first statement wins (pages often repeat hours in the footer).
  const seen = new Set<number>();
  return out.filter((h) => (seen.has(h.weekday) ? false : (seen.add(h.weekday), true)));
}

/** "Skin fade €25", "Šišanje 15 €", "Beard trim – from €12.50" */
export function parsePriceLines(lines: string[]): Array<ServiceSuggestion & { snippet: string }> {
  const out: Array<ServiceSuggestion & { snippet: string }> = [];
  const re = /^(.{3,60}?)\s*(?:[-–—:….]+\s*)?((?:from|od)\s*)?(?:€\s*(\d{1,4}(?:[.,]\d{2})?)|(\d{1,4}(?:[.,]\d{2})?)\s*(?:€|\b(?:eur(?:a)?|kn)\b))/i;
  for (const raw of lines) {
    const line = raw.trim().replace(/\s+/g, ' ');
    if (line.length > 90) continue;
    const m = line.match(re);
    if (!m) continue;
    const name = m[1]!.replace(/[-–—:.…]+$/, '').trim();
    if (!/[a-zčćšžđ]{3}/i.test(name) || /total|vat|pdv|delivery|gift card/i.test(name)) continue;
    const amount = Number((m[3] ?? m[4])!.replace(',', '.'));
    out.push({ name, priceMinor: Math.round(amount * 100), priceIsFrom: !!m[2] || /\bfrom\b|\bod\b/i.test(line), snippet: line });
  }
  const seen = new Set<string>();
  return out.filter((s) => (seen.has(s.name.toLowerCase()) ? false : (seen.add(s.name.toLowerCase()), true))).slice(0, 40);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&euro;/g, '€').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

export function htmlToLines(html: string): string[] {
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr|\/td|\/dt|\/dd|\/span)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(body)
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function jsonLdBlocks(html: string): any[] {
  const out: any[] = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(m[1]!.trim());
      const items = Array.isArray(parsed) ? parsed : parsed['@graph'] ?? [parsed];
      out.push(...items);
    } catch {
      // ignore malformed blocks
    }
  }
  return out;
}

export function extractFromHtml(html: string, sourceUrl: string): ImportSuggestions {
  const s: ImportSuggestions = { sourceUrl, fetchedAt: new Date().toISOString(), name: null, phone: null, email: null, address: null, hours: [], services: [], description: null, evidence: [], warnings: [] };
  const biz = jsonLdBlocks(html).find((b) => b && (b.address || b.telephone || b.openingHoursSpecification || b.openingHours));
  if (biz) {
    if (biz.name) (s.name = String(biz.name)), s.evidence.push({ field: 'name', source: 'structured_data', snippet: String(biz.name) });
    if (biz.telephone) (s.phone = String(biz.telephone)), s.evidence.push({ field: 'phone', source: 'structured_data', snippet: String(biz.telephone) });
    if (biz.email) s.email = String(biz.email).replace(/^mailto:/, '');
    const a = Array.isArray(biz.address) ? biz.address[0] : biz.address;
    if (a && typeof a === 'object') {
      s.address = { line: a.streetAddress ?? null, city: a.addressLocality ?? null, postcode: a.postalCode ?? null };
      s.evidence.push({ field: 'address', source: 'structured_data', snippet: [a.streetAddress, a.addressLocality, a.postalCode].filter(Boolean).join(', ') });
    } else if (typeof a === 'string') s.address = { line: a, city: null, postcode: null };
    const specs = biz.openingHoursSpecification ? (Array.isArray(biz.openingHoursSpecification) ? biz.openingHoursSpecification : [biz.openingHoursSpecification]) : [];
    for (const sp of specs) {
      const days = (Array.isArray(sp.dayOfWeek) ? sp.dayOfWeek : [sp.dayOfWeek]).map((d: string) => SCHEMA_DAYS[String(d).split('/').pop()!.toLowerCase()]).filter(Boolean);
      const opens = sp.opens ? normaliseTime(String(sp.opens).slice(0, 5)) : null;
      const closes = sp.closes ? normaliseTime(String(sp.closes).slice(0, 5)) : null;
      if (opens && closes && closes > opens) for (const d of days) s.hours.push({ weekday: d, opens, closes });
    }
    const strings: string[] = biz.openingHours ? (Array.isArray(biz.openingHours) ? biz.openingHours : [biz.openingHours]) : [];
    for (const str of strings) for (const h of parseHoursText(str)) s.hours.push({ weekday: h.weekday, opens: h.opens, closes: h.closes });
    if (s.hours.length) s.evidence.push({ field: 'hours', source: 'structured_data', snippet: JSON.stringify(biz.openingHoursSpecification ?? biz.openingHours).slice(0, 200) });
    if (biz.description) s.description = String(biz.description).slice(0, 500);
  }
  const lines = htmlToLines(html);
  const text = lines.join('\n');
  if (!s.hours.length) {
    const hours = parseHoursText(text);
    s.hours = hours.map(({ snippet: _snippet, ...h }) => h);
    for (const snip of new Set(hours.map((h) => h.snippet))) s.evidence.push({ field: 'hours', source: 'page_text', snippet: snip });
  }
  if (!s.phone) {
    const tel = html.match(/href=["']tel:([+\d\s()-]{6,20})["']/i);
    if (tel) (s.phone = tel[1]!.trim()), s.evidence.push({ field: 'phone', source: 'link', snippet: tel[0] });
  }
  if (!s.email) {
    const mail = html.match(/href=["']mailto:([^"'?]+)["']/i);
    if (mail) s.email = mail[1]!;
  }
  if (!s.name) {
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    if (title) s.name = decodeEntities(title).split(/[|–—-]/)[0]!.trim() || null;
  }
  if (!s.description) s.description = decodeEntities(html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? '') || null;
  const prices = parsePriceLines(lines);
  s.services = prices.map(({ snippet: _s, ...p }) => p);
  for (const p of prices.slice(0, 15)) s.evidence.push({ field: 'service', source: 'page_text', snippet: p.snippet });
  if (!s.hours.length) s.warnings.push('No opening hours found. Enter them by hand.');
  if (!s.services.length) s.warnings.push('No prices found on this page. Prices may be on another page, or on a booking site.');
  return s;
}

/** Fetch the homepage (and a price/services page if linked) and extract suggestions. */
export async function importFromWebsite(url: string, opts: SafeFetchOptions = {}): Promise<ImportSuggestions> {
  const home = await safeFetchText(url, opts);
  const base = new URL(home.url);
  if (!(await robotsAllows(base, base.pathname, opts))) {
    return { ...extractFromHtml('', home.url), warnings: ['This website asks automated tools not to read it. Enter details by hand.'] };
  }
  if (home.status >= 400) throw new Error(`The website answered with an error (${home.status}).`);
  const result = extractFromHtml(home.text, home.url);
  if (!result.services.length) {
    const link = home.text.match(/href=["']([^"']*(?:price|prices|pricing|services|cjenik|usluge)[^"']*)["']/i)?.[1];
    if (link) {
      const target = new URL(link, base);
      if (target.host === base.host && (await robotsAllows(base, target.pathname, opts))) {
        try {
          const page = await safeFetchText(target.toString(), opts);
          const extra = extractFromHtml(page.text, page.url);
          result.services = extra.services;
          result.evidence.push(...extra.evidence.filter((e) => e.field === 'service'));
          if (result.services.length) result.warnings = result.warnings.filter((w) => !w.startsWith('No prices'));
          if (!result.hours.length && extra.hours.length) {
            result.hours = extra.hours;
            result.warnings = result.warnings.filter((w) => !w.startsWith('No opening'));
          }
        } catch {
          // keep homepage results
        }
      }
    }
  }
  return result;
}
