import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Db, provisionClient } from '../src/index';

const db = Db.fromUrl(process.env.DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:54329/postgres');
afterAll(() => db.end());

const input = {
  businessName: 'Brijačnica Đuro',
  industry: 'barbershop' as const,
  country: 'HR' as const,
  primaryLanguage: 'hr' as const,
  additionalLanguages: ['en' as const],
  contactEmail: 'vlasnik@example.test',
  ownerEmail: 'vlasnik@example.test',
  fallbackPhone: '091 234 5678',
  hours: [2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens: '08:00', closes: '16:00' })),
  staff: [{ name: 'Đuro' }, { name: 'Marko' }],
};

describe('client provisioning from a template (E2E 1–3)', () => {
  it('creates a complete, isolated tenant with a draft agent and no hand-written prompt', async () => {
    const key = randomUUID();
    const r = await provisionClient(db, input, { actorUserId: null, idempotencyKey: key });
    const org = (await db.query(`select slug, timezone, status, fallback_phone_e164 from public.organizations where id = $1`, [r.organizationId])).rows[0];
    expect(org).toMatchObject({ slug: expect.stringMatching(/^brijacnica-duro/), timezone: 'Europe/Zagreb', status: 'onboarding', fallback_phone_e164: '+385912345678' });
    const counts = (
      await db.query(
        `select (select count(*) from public.staff_members where organization_id = $1)::int as staff,
                (select count(*) from public.services where organization_id = $1)::int as services,
                (select count(*) from public.staff_hours where organization_id = $1)::int as staff_hours,
                (select count(*) from public.onboarding_tasks where organization_id = $1 and status = 'done')::int as done`,
        [r.organizationId],
      )
    ).rows[0];
    expect(counts).toEqual({ staff: 2, services: 4, staff_hours: 10, done: 3 });
    const v = (await db.query(`select status, compiled from public.agent_versions where id = $1`, [r.agentVersionId])).rows[0];
    expect(v.status).toBe('draft');
    expect(v.compiled.firstMessage).toMatch(/Dobar dan, dobili ste Brijačnica Đuro/);
    expect(v.compiled.systemPrompt).toMatch(/Đuro/); // staff from DB are in the facts
    // Not live: blockers explain what remains, in plain language.
    expect(r.blockers).toEqual(expect.arrayContaining(['Connect a phone number', 'Run tests and publish the assistant']));
    expect(r.blockers).not.toContain('Add opening hours');
  });

  it('retrying the same submit never creates a duplicate client', async () => {
    const key = randomUUID();
    const a = await provisionClient(db, { ...input, businessName: 'Retry Barbers' }, { actorUserId: null, idempotencyKey: key });
    const b = await provisionClient(db, { ...input, businessName: 'Retry Barbers' }, { actorUserId: null, idempotencyKey: key });
    expect(b.organizationId).toBe(a.organizationId);
    const n = (await db.query(`select count(*)::int as n from public.organizations where name = 'Retry Barbers'`)).rows[0].n;
    expect(n).toBe(1);
  });

  it('rejects invalid input before touching the database', async () => {
    await expect(provisionClient(db, { ...input, fallbackPhone: '12' }, { actorUserId: null, idempotencyKey: randomUUID() })).rejects.toThrow(/phone/i);
    await expect(provisionClient(db, { ...input, industry: 'casino' as never }, { actorUserId: null, idempotencyKey: randomUUID() })).rejects.toThrow();
  });
});
