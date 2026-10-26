import pg from 'pg';

/**
 * Server-side database access. Uses a privileged connection (Supabase service role / postgres via the pooler),
 * which bypasses RLS — therefore EVERY query in this package must be scoped by an organization id that was
 * resolved server-side (from the dialled number, a verified session, or a signed webhook), never from client input.
 */
export interface Queryable {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query<R extends pg.QueryResultRow = any>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
}

export class Db {
  constructor(readonly pool: pg.Pool) {}

  static fromUrl(url: string, max = 10): Db {
    const pool = new pg.Pool({ connectionString: url, max });
    // Poolers (e.g. Supabase) close idle connections. pg emits that on the pool; unhandled, it would crash the
    // process and drop every live call. The pool discards the dead client and the next query reconnects.
    pool.on('error', (e) => console.error(JSON.stringify({ at: new Date().toISOString(), event: 'db.idle_client_error', message: e.message })));
    return new Db(pool);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query<R extends pg.QueryResultRow = any>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>> {
    return this.pool.query<R>(text, values);
  }

  /**
   * Run a transaction. `actorUserId` attributes audit-log rows to the operator who triggered the change
   * (privileges are unchanged — this only sets the identity the audit trigger records).
   */
  async tx<T>(fn: (q: Queryable) => Promise<T>, opts: { actorUserId?: string | null } = {}): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      if (opts.actorUserId) {
        await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: opts.actorUserId })]);
      }
      const out = await fn(client);
      await client.query('commit');
      return out;
    } catch (e) {
      await client.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  end(): Promise<void> {
    return this.pool.end();
  }
}

export function isExclusionViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23P01';
}
export function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';
}
