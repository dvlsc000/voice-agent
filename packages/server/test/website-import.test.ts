import { describe, expect, it } from 'vitest';
import { UnsafeUrlError, assertPublicUrl, extractFromHtml, importFromWebsite, isPublicAddress, normaliseTime, parseHoursText, parsePriceLines, robotsAllows } from '../src/index';

const publicResolver = async () => ['93.184.216.34'];

describe('SSRF protection', () => {
  it('blocks private, loopback, link-local and metadata addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', '::ffff:127.0.0.1']) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    expect(isPublicAddress('93.184.216.34')).toBe(true);
  });
  it('rejects bad schemes, ports, credentials, internal names and hostnames resolving privately', async () => {
    await expect(assertPublicUrl('file:///etc/passwd', publicResolver)).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(assertPublicUrl('http://shop.ie:6379/', publicResolver)).rejects.toThrow(/ports/);
    await expect(assertPublicUrl('http://user:pw@shop.ie/', publicResolver)).rejects.toThrow(/credentials/);
    await expect(assertPublicUrl('http://localhost/', publicResolver)).rejects.toThrow(/Internal/);
    await expect(assertPublicUrl('http://evil.example/', async () => ['10.0.0.5'])).rejects.toThrow(/private network/);
    await expect(assertPublicUrl('https://marksbarbers.ie/', publicResolver)).resolves.toBeInstanceOf(URL);
  });
  it('re-checks every redirect hop', async () => {
    const f: typeof fetch = async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } });
    await expect(importFromWebsite('https://marksbarbers.ie', { fetch: f, resolve: publicResolver })).rejects.toBeInstanceOf(UnsafeUrlError);
  });
});

describe('extraction', () => {
  it('normalises times', () => {
    expect(normaliseTime('9am')).toBe('09:00');
    expect(normaliseTime('5:30pm')).toBe('17:30');
    expect(normaliseTime('17.30')).toBe('17:30');
    expect(normaliseTime('8h')).toBeNull();
  });
  it('reads English and Croatian opening hours from text', () => {
    expect(parseHoursText('Opening hours: Mon - Fri: 9am - 6pm. Sat 10:00 - 16:00. Sunday closed').map(({ snippet: _, ...h }) => h)).toEqual([
      { weekday: 1, opens: '09:00', closes: '18:00' }, { weekday: 2, opens: '09:00', closes: '18:00' }, { weekday: 3, opens: '09:00', closes: '18:00' },
      { weekday: 4, opens: '09:00', closes: '18:00' }, { weekday: 5, opens: '09:00', closes: '18:00' }, { weekday: 6, opens: '10:00', closes: '16:00' },
    ]);
    expect(parseHoursText('Radno vrijeme: Pon - Pet 8:00 - 16:00, Sub 8 - 13').map((h) => `${h.weekday} ${h.opens}-${h.closes}`)).toEqual([
      '1 08:00-16:00', '2 08:00-16:00', '3 08:00-16:00', '4 08:00-16:00', '5 08:00-16:00', '6 08:00-13:00',
    ]);
    expect(parseHoursText('Tues-Sat 9 - 6').map((h) => h.closes)).toEqual(['18:00', '18:00', '18:00', '18:00', '18:00']);
  });
  it('reads price lists in either currency style and ignores noise', () => {
    expect(parsePriceLines(['Skin Fade €25', 'Šišanje 15 €', 'Beard trim – from €12.50', 'Gift card €50', 'Total €100']).map(({ snippet: _, ...s }) => s)).toEqual([
      { name: 'Skin Fade', priceMinor: 2500, priceIsFrom: false },
      { name: 'Šišanje', priceMinor: 1500, priceIsFrom: false },
      { name: 'Beard trim', priceMinor: 1250, priceIsFrom: true },
    ]);
  });
  it('prefers schema.org structured data and records evidence for review', () => {
    const html = `<html><head><title>Mark's Barbers | Galway</title>
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"BarberShop","name":"Mark's Barbers","telephone":"+353 91 123 456",
      "address":{"@type":"PostalAddress","streetAddress":"1 Shop St","addressLocality":"Galway","postalCode":"H91 X2Y3"},
      "openingHoursSpecification":[{"@type":"OpeningHoursSpecification","dayOfWeek":["https://schema.org/Tuesday","Wednesday"],"opens":"09:00","closes":"18:00"}]}</script>
      </head><body><ul><li>Skin fade &euro;25</li><li>Kids cut &euro;15</li></ul></body></html>`;
    const s = extractFromHtml(html, 'https://marksbarbers.ie/');
    expect(s.name).toBe("Mark's Barbers");
    expect(s.phone).toBe('+353 91 123 456');
    expect(s.address).toEqual({ line: '1 Shop St', city: 'Galway', postcode: 'H91 X2Y3' });
    expect(s.hours).toEqual([{ weekday: 2, opens: '09:00', closes: '18:00' }, { weekday: 3, opens: '09:00', closes: '18:00' }]);
    expect(s.services.map((x) => x.name)).toEqual(['Skin fade', 'Kids cut']);
    expect(s.evidence.some((e) => e.field === 'address' && e.source === 'structured_data')).toBe(true);
  });
});

describe('robots.txt', () => {
  const site = (robots: string): typeof fetch => async (input) =>
    new URL(String(input)).pathname === '/robots.txt' ? new Response(robots, { status: 200 }) : new Response('<html><li>Cut €20</li></html>', { status: 200 });
  it('respects disallow rules', async () => {
    expect(await robotsAllows(new URL('https://a.ie'), '/', { fetch: site('User-agent: *\nDisallow: /'), resolve: publicResolver })).toBe(false);
    expect(await robotsAllows(new URL('https://a.ie'), '/', { fetch: site('User-agent: *\nDisallow: /admin'), resolve: publicResolver })).toBe(true);
    const r = await importFromWebsite('https://a.ie', { fetch: site('User-agent: *\nDisallow: /'), resolve: publicResolver });
    expect(r.warnings[0]).toMatch(/asks automated tools not to read it/);
    expect(r.services).toEqual([]);
  });
});
