import { formatMoney, type Language } from '@vp/core';
import type { Queryable } from './db.js';

const DAY_NAMES: Record<Language, string[]> = {
  en: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  hr: ['ponedjeljak', 'utorak', 'srijeda', 'četvrtak', 'petak', 'subota', 'nedjelja'],
};

/**
 * Renders verified, structured business facts as compact text for the agent.
 * Only approved prices and approved knowledge items are included — unverified data never reaches a caller.
 */
export async function renderBusinessFacts(q: Queryable, organizationId: string, lang: Language): Promise<string> {
  const org = (await q.query(`select name, timezone from public.organizations where id = $1`, [organizationId])).rows[0];
  if (!org) throw new Error('Organization not found');
  const loc = (
    await q.query(`select id, address_line, city, postcode, directions from public.locations where organization_id = $1 and is_primary`, [organizationId])
  ).rows[0];
  const hours = loc
    ? (await q.query(`select weekday, to_char(opens, 'HH24:MI') as o, to_char(closes, 'HH24:MI') as c from public.business_hours where location_id = $1 order by weekday, opens`, [loc.id])).rows
    : [];
  const closures = (
    await q.query(
      `select date::text as d, closed, label from public.date_exceptions where organization_id = $1 and staff_id is null and date between current_date and current_date + 60 order by date`,
      [organizationId],
    )
  ).rows;
  const services = (
    await q.query(
      `select id, names, duration_min, price_minor, price_is_from, price_approved, currency from public.services
        where organization_id = $1 and active order by sort_order, names->>'en'`,
      [organizationId],
    )
  ).rows;
  const staff = (
    await q.query(`select id, display_name, aliases from public.staff_members where organization_id = $1 and active and bookable order by display_name`, [organizationId])
  ).rows;
  const knowledge = (
    await q.query(
      `select kind, question, content from public.knowledge_items where organization_id = $1 and status = 'approved' and language = $2 order by kind, id`,
      [organizationId, lang],
    )
  ).rows;

  const L = lang === 'en'
    ? { hours: 'Opening hours', closed: 'closed', closures: 'Upcoming closures', services: 'Services', staff: 'Staff', address: 'Address', directions: 'Directions', faq: 'FAQs and policies', noPrice: 'price not available — offer to take a message', from: 'from', min: 'min' }
    : { hours: 'Radno vrijeme', closed: 'zatvoreno', closures: 'Nadolazeća zatvaranja', services: 'Usluge', staff: 'Djelatnici', address: 'Adresa', directions: 'Upute za dolazak', faq: 'Česta pitanja i pravila', noPrice: 'cijena nije dostupna — ponudi da zabilježiš poruku', from: 'od', min: 'min' };

  const lines: string[] = [];
  lines.push(`${org.name}`);
  if (loc?.address_line) lines.push(`${L.address}: ${[loc.address_line, loc.city, loc.postcode].filter(Boolean).join(', ')}`);
  if (loc?.directions?.[lang]) lines.push(`${L.directions}: ${loc.directions[lang]}`);
  lines.push(`${L.hours}:`);
  for (let d = 1; d <= 7; d++) {
    const ranges = hours.filter((h) => h.weekday === d).map((h) => `${h.o}–${h.c}`);
    lines.push(`- ${DAY_NAMES[lang][d - 1]}: ${ranges.length ? ranges.join(', ') : L.closed}`);
  }
  if (closures.length) {
    lines.push(`${L.closures}:`);
    for (const c of closures) lines.push(`- ${c.d}${c.closed ? ` ${L.closed}` : ''}${c.label ? ` (${c.label})` : ''}`);
  }
  lines.push(`${L.services} [service_id]:`);
  for (const s of services) {
    const name = s.names[lang] ?? s.names.en ?? s.names.hr;
    const price =
      s.price_minor !== null && s.price_approved
        ? `${s.price_is_from ? `${L.from} ` : ''}${formatMoney(s.price_minor, s.currency, lang)}`
        : L.noPrice;
    lines.push(`- ${name} [${s.id}]: ${s.duration_min} ${L.min}, ${price}`);
  }
  if (staff.length) {
    lines.push(`${L.staff} [staff_id]:`);
    for (const s of staff) lines.push(`- ${s.display_name}${s.aliases.length ? ` (${s.aliases.join(', ')})` : ''} [${s.id}]`);
  }
  if (knowledge.length) {
    lines.push(`${L.faq}:`);
    for (const k of knowledge) lines.push(k.question ? `- Q: ${k.question} A: ${k.content}` : `- ${k.content}`);
  }
  return lines.join('\n');
}
