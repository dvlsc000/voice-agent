import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { as, client, insertAppointment, rejects, seed, type Fixture } from './helpers.js';

let c: pg.Client;
let f: Fixture;

beforeAll(async () => {
  c = client();
  await c.connect();
  f = await seed(c);
});
afterAll(async () => {
  await c.end();
});

const TENANT_TABLES = [
  'organizations',
  'organization_members',
  'staff_members',
  'services',
  'customers',
  'calls',
  'call_transcripts',
  'enquiries',
] as const;

describe('tenant isolation (spec E2E #14)', () => {
  it('an owner sees only their own organization across every tenant table', async () => {
    await as(c, f.users.carl, async (q) => {
      for (const t of TENANT_TABLES) {
        const col = t === 'organizations' ? 'id' : 'organization_id';
        const { rows } = await q(`select distinct ${col} as org from public.${t}`);
        expect(rows.map((r) => r.org), t).toEqual([f.orgB]);
      }
    });
  });

  it('a user with no membership sees nothing', async () => {
    await as(c, f.users.outsider, async (q) => {
      for (const t of TENANT_TABLES) {
        const { rowCount } = await q(`select 1 from public.${t}`);
        expect(rowCount, t).toBe(0);
      }
    });
  });

  it('anonymous requests are refused outright', async () => {
    await as(c, null, async (q) => {
      await rejects(q('select * from public.organizations'), /permission denied/);
    });
    await as(c, null, async (q) => {
      await rejects(q('select * from public.customers'), /permission denied/);
    });
  });

  it('cannot write into another tenant', async () => {
    await as(c, f.users.carl, async (q) => {
      await rejects(
        q(`insert into public.services (organization_id, names, duration_min) values ($1, '{"en":"x"}', 30)`, [f.orgA]),
        /row-level security/,
      );
    });
    await as(c, f.users.carl, async (q) => {
      const r = await q(`update public.services set duration_min = 5 where organization_id = $1`, [f.orgA]);
      expect(r.rowCount).toBe(0);
      const d = await q(`delete from public.customers where organization_id = $1`, [f.orgA]);
      expect(d.rowCount).toBe(0);
    });
  });

  it('cannot move a row into another tenant by changing organization_id', async () => {
    await as(c, f.users.carl, async (q) => {
      await rejects(q(`update public.services set organization_id = $1 where id = $2`, [f.orgA, f.serviceB]), /row-level security/);
    });
  });

  it('cannot reference another tenant’s staff even with a valid id (composite FK)', async () => {
    await as(c, f.users.carl, async (q) => {
      await rejects(
        q(`insert into public.staff_hours (organization_id, staff_id, weekday, starts, ends) values ($1, $2, 1, '09:00', '17:00')`, [f.orgB, f.staffA]),
        /foreign key/,
      );
    });
  });

  it('platform support can read all tenants but cannot write', async () => {
    await as(c, f.users.support, async (q) => {
      const { rows } = await q('select id from public.organizations where id in ($1, $2)', [f.orgA, f.orgB]);
      expect(rows).toHaveLength(2);
      const r = await q(`update public.services set duration_min = 5`);
      expect(r.rowCount).toBe(0);
    });
  });
});

describe('roles within a tenant', () => {
  it('analysts see call metadata but not personal data or transcripts', async () => {
    await as(c, f.users.ann, async (q) => {
      expect((await q('select 1 from public.calls')).rowCount).toBe(1);
      expect((await q('select 1 from public.customers')).rowCount).toBe(0);
      expect((await q('select 1 from public.call_transcripts')).rowCount).toBe(0);
      expect((await q('select 1 from public.enquiries')).rowCount).toBe(0);
    });
  });

  it('receptionists can work enquiries but not change configuration', async () => {
    await as(c, f.users.bob, async (q) => {
      const r = await q(`update public.enquiries set status = 'done' where organization_id = $1`, [f.orgA]);
      expect(r.rowCount).toBe(1);
      const s = await q(`update public.services set duration_min = 60 where organization_id = $1`, [f.orgA]);
      expect(s.rowCount).toBe(0);
    });
  });

  it('members cannot change their organization’s status or read the reference salt', async () => {
    await as(c, f.users.alice, async (q) => {
      await rejects(q(`update public.organizations set status = 'active' where id = $1`, [f.orgA]), /permission denied/);
    });
    await as(c, f.users.alice, async (q) => {
      await rejects(q(`select reference_salt from public.organizations`), /permission denied/);
    });
    await as(c, f.users.alice, async (q) => {
      const r = await q(`update public.organizations set name = 'Mark''s Barbers Galway' where id = $1`, [f.orgA]);
      expect(r.rowCount).toBe(1);
    });
  });

  it('only owners manage membership, and the last owner cannot be removed', async () => {
    await as(c, f.users.bob, async (q) => {
      await rejects(
        q(`insert into public.organization_members (organization_id, user_id, role) values ($1, $2, 'owner')`, [f.orgA, f.users.outsider]),
        /row-level security/,
      );
    });
    await as(c, f.users.alice, async (q) => {
      await rejects(q(`delete from public.organization_members where user_id = $1`, [f.users.alice]), /at least one owner/);
    });
  });

  it('integration secrets and internal tables are unreachable for every client role', async () => {
    for (const t of ['integration_secrets', 'jobs', 'webhook_events', 'usage_events', 'provider_cost_events']) {
      await as(c, f.users.alice, async (q) => {
        await rejects(q(`select * from public.${t}`), /permission denied/);
      });
    }
  });

  it('audit trail records config changes and stays inside the tenant', async () => {
    await c.query(`update public.services set duration_min = 50 where id = $1`, [f.serviceA]);
    await as(c, f.users.alice, async (q) => {
      const { rows } = await q(`select action, target_table from public.audit_logs where target_id = $1`, [f.serviceA]);
      expect(rows.some((r) => r.action === 'update' && r.target_table === 'services')).toBe(true);
    });
    await as(c, f.users.carl, async (q) => {
      expect((await q(`select 1 from public.audit_logs where organization_id = $1`, [f.orgA])).rowCount).toBe(0);
    });
    const { rows } = await c.query(`select new_data from public.audit_logs where target_table = 'organizations' limit 1`);
    expect(rows[0].new_data.reference_salt).toBeUndefined();
  });
});

describe('booking integrity (spec E2E #11)', () => {
  it('the database rejects overlapping live bookings for the same staff member', async () => {
    await c.query('begin');
    try {
      await insertAppointment(c, { org: f.orgA, staff: f.staffA, service: f.serviceA, start: '2030-01-08T10:00:00Z', minutes: 45 });
      await rejects(
        insertAppointment(c, { org: f.orgA, staff: f.staffA, service: f.serviceA, start: '2030-01-08T10:30:00Z', minutes: 45 }),
        /appointments_no_double_booking/,
      );
    } finally {
      await c.query('rollback');
    }
  });

  it('allows the same time with a different staff member, and after cancellation', async () => {
    await c.query('begin');
    try {
      const a = await insertAppointment(c, { org: f.orgA, staff: f.staffA, service: f.serviceA, start: '2030-01-09T10:00:00Z', minutes: 45 });
      await insertAppointment(c, { org: f.orgA, staff: f.staffA2, service: f.serviceA, start: '2030-01-09T10:00:00Z', minutes: 45 });
      await c.query(`update public.appointments set status = 'cancelled' where id = $1`, [a]);
      await insertAppointment(c, { org: f.orgA, staff: f.staffA, service: f.serviceA, start: '2030-01-09T10:00:00Z', minutes: 45 });
    } finally {
      await c.query('rollback');
    }
  });

  it('two concurrent callers racing for one slot: exactly one wins', async () => {
    const c1 = client();
    const c2 = client();
    await Promise.all([c1.connect(), c2.connect()]);
    const start = '2030-02-01T14:00:00Z';
    try {
      const results = await Promise.allSettled([
        insertAppointment(c1, { org: f.orgA, staff: f.staffA, service: f.serviceA, start, minutes: 45 }),
        insertAppointment(c2, { org: f.orgA, staff: f.staffA, service: f.serviceA, start, minutes: 45 }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    } finally {
      await c.query(`delete from public.appointments where starts_at = $1`, [start]);
      await Promise.all([c1.end(), c2.end()]);
    }
  });

  it('enforces the booking state machine and logs every transition', async () => {
    await c.query('begin');
    try {
      const id = await insertAppointment(c, { org: f.orgA, staff: f.staffA, service: f.serviceA, start: '2030-01-10T10:00:00Z', minutes: 30 });
      await c.query(`update public.appointments set status = 'committing' where id = $1`, [id]);
      await c.query(`update public.appointments set status = 'confirmed' where id = $1`, [id]);
      const { rows } = await c.query(`select from_status, to_status from public.appointment_events where appointment_id = $1 order by id`, [id]);
      expect(rows.map((r) => `${r.from_status ?? '∅'}>${r.to_status}`)).toEqual(['∅>holding', 'holding>committing', 'committing>confirmed']);
      await rejects(c.query(`update public.appointments set status = 'holding' where id = $1`, [id]), /Illegal booking transition/);
    } finally {
      await c.query('rollback');
    }
  });

  it('expired holds stop blocking availability', async () => {
    await c.query('begin');
    try {
      const id = await insertAppointment(c, { org: f.orgA, staff: f.staffA, service: f.serviceA, start: '2030-01-11T10:00:00Z', minutes: 30 });
      await c.query(`update public.appointments set hold_expires_at = now() - interval '1 second' where id = $1`, [id]);
      const { rows } = await c.query(`select private.expire_stale_holds($1) as n`, [f.orgA]);
      expect(rows[0].n).toBe(1);
      await insertAppointment(c, { org: f.orgA, staff: f.staffA, service: f.serviceA, start: '2030-01-11T10:00:00Z', minutes: 30 });
    } finally {
      await c.query('rollback');
    }
  });

  it('clients cannot create or confirm bookings directly (server-side booking engine only)', async () => {
    await as(c, f.users.alice, async (q) => {
      await rejects(
        q(
          `insert into public.appointments (organization_id, staff_id, service_id, status, starts_at, ends_at, block_start, block_end, source, idempotency_key)
           values ($1, $2, $3, 'confirmed', now(), now() + interval '30 min', now(), now() + interval '30 min', 'dashboard', 'x')`,
          [f.orgA, f.staffA, f.serviceA],
        ),
        /permission denied/,
      );
    });
  });
});

describe('agent versioning', () => {
  it('published versions are immutable', async () => {
    await c.query('begin');
    try {
      await c.query(`insert into public.industry_templates (id, version, definition, is_current) values ('barbershop', 1, '{}', true)`);
      const agent = (await c.query(`insert into public.agents (organization_id, name) values ($1, 'Main') returning id`, [f.orgA])).rows[0].id;
      const v = (
        await c.query(
          `insert into public.agent_versions (organization_id, agent_id, version_no, template_id, template_version, settings, compiled, content_hash, status, published_at)
           values ($1, $2, 1, 'barbershop', 1, '{}', '{"systemPrompt":"x"}', 'abc', 'published', now()) returning id`,
          [f.orgA, agent],
        )
      ).rows[0].id;
      await c.query('savepoint s');
      await rejects(c.query(`update public.agent_versions set compiled = '{"systemPrompt":"y"}' where id = $1`, [v]), /immutable/);
      await c.query('rollback to savepoint s');
      await c.query(`update public.agent_versions set status = 'archived' where id = $1`, [v]);
    } finally {
      await c.query('rollback');
    }
  });
});

describe('platform operations', () => {
  it('jobs are claimed once across workers and dead-lettered after max attempts', async () => {
    await c.query('begin');
    try {
      await c.query(`insert into public.jobs (kind, max_attempts) values ('test', 2), ('test', 2)`);
      const a = await c.query(`select * from private.claim_jobs('default', 'w1', 1)`);
      const b = await c.query(`select * from private.claim_jobs('default', 'w2', 5)`);
      expect(a.rowCount).toBe(1);
      expect(b.rowCount).toBe(1);
      expect(a.rows[0].id).not.toBe(b.rows[0].id);
      const id = a.rows[0].id;
      await c.query(`select private.fail_job($1, 'boom')`, [id]);
      expect((await c.query(`select status from public.jobs where id = $1`, [id])).rows[0].status).toBe('queued');
      await c.query(`update public.jobs set run_at = now() - interval '1 hour' where id = $1`, [id]);
      await c.query(`select * from private.claim_jobs('default', 'w1', 1)`);
      await c.query(`select private.fail_job($1, 'boom again')`, [id]);
      expect((await c.query(`select status from public.jobs where id = $1`, [id])).rows[0].status).toBe('dead');
    } finally {
      await c.query('rollback');
    }
  });

  it('duplicate webhooks are rejected by the unique key', async () => {
    await c.query('begin');
    try {
      const ins = `insert into public.webhook_events (provider, event_id, event_type, signature_valid, payload) values ('stripe', 'evt_1', 'invoice.paid', true, '{}')`;
      await c.query(ins);
      await rejects(c.query(ins), /duplicate key/);
    } finally {
      await c.query('rollback');
    }
  });

  it('retention removes expired transcripts', async () => {
    await c.query('begin');
    try {
      await c.query(`update public.call_transcripts set retain_until = now() - interval '1 day' where call_id = $1`, [f.callA]);
      const { rows } = await c.query(`select private.apply_retention() as r`);
      expect(rows[0].r.transcripts).toBe(1);
      expect((await c.query(`select 1 from public.call_transcripts where call_id = $1`, [f.callA])).rowCount).toBe(0);
    } finally {
      await c.query('rollback');
    }
  });

  it('pricing plans ship inactive until a price is deliberately set', async () => {
    const { rows } = await c.query(`select count(*)::int as n from public.plans where active`);
    expect(rows[0].n).toBe(0);
  });
});
