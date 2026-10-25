import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Db, GoLiveBlockedError, TwilioNumbers, applyImportSuggestions, extractFromHtml, goLive, provisionClient, registerPhoneNumber, setOnboardingTask } from '../src/index';

const db = Db.fromUrl(process.env.DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:54329/postgres');
let org: string;
let agentVersionId: string;
let agentId: string;
afterAll(() => db.end());
beforeAll(async () => {
  const r = await provisionClient(db, { businessName: 'Golive Barbers', industry: 'barbershop', country: 'IE', primaryLanguage: 'en', contactEmail: 'o@gl.test', ownerEmail: 'o@gl.test', staff: [{ name: 'Mark' }] }, { actorUserId: null, idempotencyKey: randomUUID() });
  org = r.organizationId;
  agentVersionId = r.agentVersionId;
  agentId = r.agentId;
});

describe('onboarding to go-live', () => {
  it('applies only the website details the operator ticked, with prices unapproved', async () => {
    const html = `<script type="application/ld+json">{"@type":"BarberShop","telephone":"091 123 456","address":{"streetAddress":"2 Quay St","addressLocality":"Galway"},
      "openingHoursSpecification":[{"dayOfWeek":["Tuesday","Saturday"],"opens":"09:00","closes":"18:00"}]}</script><li>Skin fade €25</li><li>Hot towel shave €30</li>`;
    const s = extractFromHtml(html, 'https://golive.ie');
    const r = await applyImportSuggestions(db, { organizationId: org, suggestions: s, apply: { address: true, phone: true, hours: true, services: ['Hot towel shave'] }, country: 'IE', actorUserId: null });
    expect(r.applied).toEqual(['address', 'phone', 'hours', 'service:Hot towel shave']);
    const loc = (await db.query(`select address_line from public.locations where organization_id = $1`, [org])).rows[0];
    expect(loc.address_line).toBe('2 Quay St');
    const svc = (await db.query(`select price_minor, price_approved from public.services where organization_id = $1 and names ->> 'en' = 'Hot towel shave'`, [org])).rows[0];
    expect(svc).toEqual({ price_minor: 3000, price_approved: false });
    const skin = (await db.query(`select price_minor from public.services where organization_id = $1 and names ->> 'en' = 'Skin fade'`, [org])).rows[0];
    expect(skin.price_minor).toBeNull(); // not ticked → untouched
    const hours = (await db.query(`select count(*)::int as n from public.business_hours where organization_id = $1`, [org])).rows[0].n;
    expect(hours).toBe(2);
  });

  it('refuses to go live and says exactly what is missing', async () => {
    try {
      await goLive(db, { organizationId: org, actorUserId: null });
      throw new Error('should have failed');
    } catch (e) {
      expect(e).toBeInstanceOf(GoLiveBlockedError);
      expect((e as GoLiveBlockedError).blockers).toEqual(expect.arrayContaining([
        'Approve service prices (unapproved prices are never quoted)', 'Connect a phone number', 'Set a fallback number for transfers and outages',
        'Run tests and publish the assistant', 'Make a supervised test call and confirm it went well',
      ]));
    }
  });

  it('goes live once every gate is satisfied', async () => {
    await db.query(`update public.services set price_approved = true where organization_id = $1 and price_minor is not null`, [org]);
    await db.query(`update public.organizations set fallback_phone_e164 = '+35391999888' where id = $1`, [org]);
    await registerPhoneNumber(db, { organizationId: org, e164: '091 555 777', country: 'IE', connectionType: 'provider_number', provider: 'twilio', providerNumberId: 'PN1', status: 'active', actorUserId: null });
    await db.query(`update public.agent_versions set status = 'published', published_at = now() where id = $1`, [agentVersionId]);
    await db.query(`update public.agents set active_version_id = $1 where id = $2`, [agentVersionId, agentId]);
    await setOnboardingTask(db, { organizationId: org, kind: 'supervised_test_call', status: 'done', actorUserId: null });
    await goLive(db, { organizationId: org, actorUserId: null });
    const o = (await db.query(`select status from public.organizations where id = $1`, [org])).rows[0];
    expect(o.status).toBe('trial');
    const s = (await db.query(`select status from public.onboarding_sessions where organization_id = $1`, [org])).rows[0];
    expect(s.status).toBe('live');
  });

  it('one number can never route to two businesses', async () => {
    const other = await provisionClient(db, { businessName: 'Other', industry: 'barbershop', country: 'IE', primaryLanguage: 'en', contactEmail: 'x@x.test', ownerEmail: 'x@x.test' }, { actorUserId: null, idempotencyKey: randomUUID() });
    await expect(registerPhoneNumber(db, { organizationId: other.organizationId, e164: '+35391555777', country: 'IE', connectionType: 'forwarded', provider: 'twilio', status: 'active', actorUserId: null })).rejects.toThrow(/duplicate key/);
  });

  it('configures an existing Twilio number to point at the gateway', async () => {
    const seen: string[] = [];
    const f: typeof fetch = async (input, init) => {
      seen.push(`${init?.method} ${new URL(String(input)).pathname}${init?.body ? ' ' + String(init.body) : ''}`);
      if ((init?.method ?? 'GET') === 'GET') return new Response(JSON.stringify({ incoming_phone_numbers: [{ sid: 'PN42' }] }), { status: 200 });
      return new Response(JSON.stringify({ sid: 'PN42' }), { status: 200 });
    };
    const r = await new TwilioNumbers({ accountSid: 'AC1', authToken: 't', fetch: f }).configureExisting({ e164: '+35391555777', voiceUrl: 'https://voice.test/twilio/voice', statusCallback: 'https://voice.test/twilio/status' });
    expect(r.sid).toBe('PN42');
    expect(seen[1]).toContain('VoiceUrl=https%3A%2F%2Fvoice.test%2Ftwilio%2Fvoice');
  });
});
