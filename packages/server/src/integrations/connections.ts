import { randomUUID } from 'node:crypto';
import { CalendarUnavailableError, type CalendarAdapter } from '@vp/core';
import type { CalendarBinding } from '../booking-service';
import type { Db, Queryable } from '../db';
import { GoogleCalendarAdapter, GoogleRefreshTokenProvider } from './google-calendar';

/**
 * Where integration credentials live. Production: Supabase Vault (encrypted at rest, readable only by the
 * service role). Our tables hold just the vault secret id — tokens never sit in ordinary columns or logs.
 */
export interface SecretStore {
  create(name: string, value: string): Promise<string>;
  read(id: string): Promise<string>;
  update(id: string, value: string): Promise<void>;
  remove(id: string): Promise<void>;
}

export class VaultSecretStore implements SecretStore {
  constructor(private readonly db: Queryable) {}
  async create(name: string, value: string): Promise<string> {
    const { rows } = await this.db.query(`select vault.create_secret($1, $2) as id`, [value, name]);
    return rows[0].id;
  }
  async read(id: string): Promise<string> {
    const { rows } = await this.db.query(`select decrypted_secret from vault.decrypted_secrets where id = $1`, [id]);
    if (!rows[0]) throw new Error('Secret not found');
    return rows[0].decrypted_secret;
  }
  async update(id: string, value: string): Promise<void> {
    await this.db.query(`select vault.update_secret($1, $2)`, [id, value]);
  }
  async remove(id: string): Promise<void> {
    await this.db.query(`delete from vault.secrets where id = $1`, [id]);
  }
}

/** For tests and local development only. */
export class MemorySecretStore implements SecretStore {
  readonly values = new Map<string, string>();
  async create(_: string, value: string): Promise<string> {
    const id = randomUUID();
    this.values.set(id, value);
    return id;
  }
  async read(id: string): Promise<string> {
    const v = this.values.get(id);
    if (v === undefined) throw new Error('Secret not found');
    return v;
  }
  async update(id: string, value: string): Promise<void> {
    this.values.set(id, value);
  }
  async remove(id: string): Promise<void> {
    this.values.delete(id);
  }
}

export async function saveCalendarConnection(
  db: Db,
  secrets: SecretStore,
  input: { organizationId: string; provider: 'google_calendar' | 'microsoft_calendar'; refreshToken: string; accountLabel: string | null; scopes: string[]; actorUserId: string | null },
): Promise<string> {
  const secretId = await secrets.create(`calendar:${input.organizationId}:${randomUUID()}`, input.refreshToken);
  try {
    return await db.tx(async (q) => {
      const id = randomUUID();
      await q.query(
        `insert into public.integration_connections (id, organization_id, provider, status, account_label, scopes, last_sync_at)
         values ($1, $2, $3, 'connected', $4, $5, now())`,
        [id, input.organizationId, input.provider, input.accountLabel, input.scopes],
      );
      await q.query(`insert into public.integration_secrets (connection_id, vault_secret_id) values ($1, $2)`, [id, secretId]);
      await q.query(`update public.onboarding_tasks set status = 'done' where organization_id = $1 and kind = 'calendar_connection'`, [input.organizationId]);
      return id;
    }, { actorUserId: input.actorUserId });
  } catch (e) {
    await secrets.remove(secretId).catch(() => undefined);
    throw e;
  }
}

/** Disconnect: forget the token, detach staff, keep an audit trail. Bookings stay in our database. */
export async function disconnectCalendar(db: Db, secrets: SecretStore, input: { organizationId: string; connectionId: string; actorUserId: string | null }): Promise<void> {
  const { rows } = await db.query(
    `select s.vault_secret_id from public.integration_secrets s join public.integration_connections c on c.id = s.connection_id
      where c.id = $1 and c.organization_id = $2`,
    [input.connectionId, input.organizationId],
  );
  await db.tx(async (q) => {
    await q.query(`update public.staff_members set calendar_connection_id = null, external_calendar_id = null where organization_id = $1 and calendar_connection_id = $2`, [input.organizationId, input.connectionId]);
    await q.query(`delete from public.integration_secrets where connection_id = $1`, [input.connectionId]);
    await q.query(`update public.integration_connections set status = 'revoked' where id = $1 and organization_id = $2`, [input.connectionId, input.organizationId]);
  }, { actorUserId: input.actorUserId });
  if (rows[0]) await secrets.remove(rows[0].vault_secret_id).catch(() => undefined);
}

/**
 * Builds the `resolveCalendar` dependency for BookingService / the worker: staff with a connected external
 * calendar get an adapter; everyone else uses the built-in calendar (null).
 */
export function calendarResolver(
  db: Db,
  secrets: SecretStore,
  google: { clientId: string; clientSecret: string } | null,
  fetchImpl?: typeof fetch,
): (organizationId: string, staffId: string) => Promise<CalendarBinding | null> {
  const adapters = new Map<string, CalendarAdapter>();
  return async (organizationId, staffId) => {
    const { rows } = await db.query(
      `select c.id, c.provider, c.status, st.external_calendar_id, s.vault_secret_id
         from public.staff_members st
         join public.integration_connections c on c.id = st.calendar_connection_id and c.organization_id = st.organization_id
         left join public.integration_secrets s on s.connection_id = c.id
        where st.organization_id = $1 and st.id = $2`,
      [organizationId, staffId],
    );
    const r = rows[0];
    if (!r) return null;
    if (r.status !== 'connected' || !r.vault_secret_id) {
      // A connected calendar that stopped working must not silently fall back to the built-in diary.
      return { adapter: brokenAdapter(`Calendar connection ${r.status}`), calendarId: r.external_calendar_id ?? 'primary' };
    }
    if (r.provider !== 'google_calendar' || !google) return { adapter: brokenAdapter(`${r.provider} not configured`), calendarId: 'primary' };
    let adapter: CalendarAdapter | undefined = adapters.get(r.id);
    if (!adapter) {
      adapter = new GoogleCalendarAdapter({
        fetch: fetchImpl,
        tokens: new GoogleRefreshTokenProvider({
          ...google,
          fetch: fetchImpl,
          getRefreshToken: () => secrets.read(r.vault_secret_id),
          onRevoked: async () => {
            await db.query(`update public.integration_connections set status = 'error', last_error = 'Access revoked. Reconnect the calendar.' where id = $1`, [r.id]);
          },
        }),
      });
      adapters.set(r.id, adapter);
    }
    return { adapter, calendarId: r.external_calendar_id ?? 'primary' };
  };
}

function brokenAdapter(reason: string): CalendarAdapter {
  const fail = async (): Promise<never> => {
    throw new CalendarUnavailableError(reason);
  };
  return { kind: 'google', listBusy: fail, createBooking: fail, findByIdempotencyKey: fail, moveBooking: fail, cancelBooking: fail };
}
