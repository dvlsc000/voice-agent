import pg from 'pg';
import { randomUUID } from 'node:crypto';

export const url = process.env.DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:54329/postgres';

export function client(): pg.Client {
  return new pg.Client({ connectionString: url });
}

/** Run `fn` as a Supabase `authenticated` user (or anon when userId is null) inside a rolled-back transaction. */
export async function as<T>(c: pg.Client, userId: string | null, fn: (q: pg.Client['query']) => Promise<T>): Promise<T> {
  await c.query('begin');
  try {
    await c.query(`set local role ${userId ? 'authenticated' : 'anon'}`);
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify(userId ? { sub: userId, role: 'authenticated' } : { role: 'anon' }),
    ]);
    return await fn(c.query.bind(c) as pg.Client['query']);
  } finally {
    await c.query('rollback');
  }
}

/** Expect a query to fail with a Postgres error whose message matches. */
export async function rejects(p: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await p;
  } catch (e) {
    const msg = (e as Error).message;
    if (!pattern.test(msg)) throw new Error(`Expected error matching ${pattern}, got: ${msg}`);
    return;
  }
  throw new Error(`Expected query to fail with ${pattern}, but it succeeded`);
}

export interface Fixture {
  users: Record<'alice' | 'bob' | 'ann' | 'carl' | 'support' | 'outsider', string>;
  orgA: string;
  orgB: string;
  staffA: string;
  staffA2: string;
  staffB: string;
  serviceA: string;
  serviceB: string;
  customerA: string;
  customerB: string;
  callA: string;
  callB: string;
}

/** Seed two tenants as the service role (the server), mirroring how onboarding creates tenants. */
export async function seed(c: pg.Client): Promise<Fixture> {
  const u = {
    alice: randomUUID(),
    bob: randomUUID(),
    ann: randomUUID(),
    carl: randomUUID(),
    support: randomUUID(),
    outsider: randomUUID(),
  };
  for (const [name, id] of Object.entries(u)) {
    await c.query('insert into auth.users (id, email) values ($1, $2)', [id, `${name}-${id.slice(0, 6)}@example.test`]);
  }
  await c.query(`insert into public.platform_staff (user_id, role) values ($1, 'platform_support')`, [u.support]);

  const org = async (name: string, country: 'IE' | 'HR', tz: string, lang: 'en' | 'hr') =>
    (
      await c.query(
        `insert into public.organizations (name, slug, industry_template_id, country, timezone, primary_language)
         values ($1, $2, 'barbershop', $3, $4, $5) returning id`,
        [name, `${name.toLowerCase().replace(/\W+/g, '-')}-${randomUUID().slice(0, 6)}`, country, tz, lang],
      )
    ).rows[0].id as string;
  const orgA = await org('Marks Barbers', 'IE', 'Europe/Dublin', 'en');
  const orgB = await org('Brijacnica Ivan', 'HR', 'Europe/Zagreb', 'hr');

  const member = (o: string, user: string, role: string) =>
    c.query('insert into public.organization_members (organization_id, user_id, role) values ($1, $2, $3)', [o, user, role]);
  await member(orgA, u.alice, 'owner');
  await member(orgA, u.bob, 'receptionist');
  await member(orgA, u.ann, 'analyst');
  await member(orgB, u.carl, 'owner');

  const staff = async (o: string, n: string) =>
    (await c.query('insert into public.staff_members (organization_id, display_name) values ($1, $2) returning id', [o, n])).rows[0].id as string;
  const staffA = await staff(orgA, 'Mark');
  const staffA2 = await staff(orgA, 'Aoife');
  const staffB = await staff(orgB, 'Ivan');

  const service = async (o: string) =>
    (
      await c.query(
        `insert into public.services (organization_id, names, duration_min, buffer_after_min, price_minor, price_approved)
         values ($1, '{"en":"Skin fade","hr":"Skin fade"}', 45, 15, 2500, true) returning id`,
        [o],
      )
    ).rows[0].id as string;
  const serviceA = await service(orgA);
  const serviceB = await service(orgB);

  const customer = async (o: string, phone: string) =>
    (await c.query('insert into public.customers (organization_id, full_name, phone_e164) values ($1, $2, $3) returning id', [o, 'Test Customer', phone]))
      .rows[0].id as string;
  const customerA = await customer(orgA, '+353871234567');
  const customerB = await customer(orgB, '+385912345678');

  const call = async (o: string) =>
    (
      await c.query(
        `insert into public.calls (organization_id, provider, provider_call_id, started_at, from_e164, outcome)
         values ($1, 'test', $2, now(), '+353870000000', 'booked') returning id`,
        [o, randomUUID()],
      )
    ).rows[0].id as string;
  const callA = await call(orgA);
  const callB = await call(orgB);
  for (const [o, cl] of [[orgA, callA], [orgB, callB]] as const) {
    await c.query(
      `insert into public.call_transcripts (call_id, organization_id, segments, retain_until) values ($1, $2, '[{"role":"caller","text":"hello"}]', now() + interval '90 days')`,
      [cl, o],
    );
    await c.query(
      `insert into public.enquiries (organization_id, call_id, kind, caller_name, callback_phone_e164, summary) values ($1, $2, 'message', 'Caller', '+353871111111', 'Please call back')`,
      [o, cl],
    );
  }

  return { users: u, orgA, orgB, staffA, staffA2, staffB, serviceA, serviceB, customerA, customerB, callA, callB };
}

export async function insertAppointment(
  c: pg.Client,
  f: { org: string; staff: string; service: string; start: string; minutes: number; status?: string; key?: string },
): Promise<string> {
  const res = await c.query(
    `insert into public.appointments (organization_id, staff_id, service_id, status, starts_at, ends_at, block_start, block_end,
                                      hold_expires_at, source, idempotency_key)
     values ($1, $2, $3, $4::public.booking_status, $5::timestamptz, $5::timestamptz + make_interval(mins => $6),
             $5::timestamptz, $5::timestamptz + make_interval(mins => $6), now() + interval '5 minutes', 'voice', $7)
     returning id`,
    [f.org, f.staff, f.service, f.status ?? 'holding', f.start, f.minutes, f.key ?? randomUUID()],
  );
  return res.rows[0].id as string;
}
