import { createHash } from 'node:crypto';
import {
  CalendarConflictError,
  CalendarOutcomeUnknownError,
  CalendarUnavailableError,
  type CalendarAdapter,
  type ExternalBookingRef,
  type Slot,
} from '@vp/core';

/**
 * Google Calendar adapter (Calendar API v3).
 * Scopes: calendar.events (create/move/cancel our events) + calendar.freebusy (busy times only — we never read
 * the content of the business's other events).
 *
 * Idempotency: the event id is derived from our idempotency key (hex ⊂ base32hex), so a retried create cannot
 * produce a duplicate; an "already exists" response is treated as success after reading the event back.
 */
export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.freebusy', 'openid', 'email'];

export interface AccessTokenProvider {
  /** Returns a valid access token; `forceRefresh` after a 401. */
  getAccessToken(forceRefresh?: boolean): Promise<string>;
}

export function googleEventId(idempotencyKey: string): string {
  return createHash('sha256').update(idempotencyKey).digest('hex'); // 64 chars of [0-9a-f]
}

export class GoogleCalendarAdapter implements CalendarAdapter {
  readonly kind = 'google' as const;
  constructor(private readonly opts: { tokens: AccessTokenProvider; fetch?: typeof fetch; timeoutMs?: number; baseUrl?: string }) {}

  private async request(method: string, path: string, body?: unknown, retried = false): Promise<Response> {
    const token = await this.opts.tokens.getAccessToken(retried);
    const res = await (this.opts.fetch ?? fetch)(`${this.opts.baseUrl ?? 'https://www.googleapis.com/calendar/v3'}${path}`, {
      method,
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 6000),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401 && !retried) return this.request(method, path, body, true);
    return res;
  }

  async listBusy(input: { staffCalendarIds: Record<string, string>; from: string; to: string }): Promise<Array<{ staffId: string; start: string; end: string }>> {
    const entries = Object.entries(input.staffCalendarIds);
    if (!entries.length) return [];
    let res: Response;
    try {
      res = await this.request('POST', '/freeBusy', { timeMin: input.from, timeMax: input.to, items: entries.map(([, id]) => ({ id })) });
    } catch (e) {
      throw new CalendarUnavailableError(`Google freeBusy failed: ${(e as Error).message}`);
    }
    if (!res.ok) throw new CalendarUnavailableError(`Google freeBusy HTTP ${res.status}`);
    const json = (await res.json()) as { calendars?: Record<string, { busy?: Array<{ start: string; end: string }>; errors?: unknown[] }> };
    const out: Array<{ staffId: string; start: string; end: string }> = [];
    for (const [staffId, calId] of entries) {
      const cal = json.calendars?.[calId];
      if (!cal || cal.errors?.length) throw new CalendarUnavailableError(`Calendar ${calId} not readable`);
      for (const b of cal.busy ?? []) out.push({ staffId, start: new Date(b.start).toISOString(), end: new Date(b.end).toISOString() });
    }
    return out;
  }

  async createBooking(input: { slot: Slot; calendarId: string; title: string; description: string; idempotencyKey: string }): Promise<ExternalBookingRef> {
    const id = googleEventId(input.idempotencyKey);
    const cal = encodeURIComponent(input.calendarId);
    let res: Response;
    try {
      res = await this.request('POST', `/calendars/${cal}/events?sendUpdates=none`, {
        id,
        summary: input.title,
        description: input.description,
        start: { dateTime: input.slot.start },
        end: { dateTime: input.slot.end },
        extendedProperties: { private: { vpIdempotencyKey: input.idempotencyKey } },
      });
    } catch (e) {
      // Timed out or connection dropped after sending: the event may or may not exist.
      throw new CalendarOutcomeUnknownError(`Google create: ${(e as Error).message}`);
    }
    if (res.ok) {
      const ev = (await res.json()) as { id: string; etag?: string };
      return { externalId: ev.id, etag: ev.etag };
    }
    if (res.status === 409) {
      const existing = await this.findByIdempotencyKey({ calendarId: input.calendarId, idempotencyKey: input.idempotencyKey, around: input.slot.start });
      if (existing) return existing;
      throw new CalendarConflictError('Event id collision');
    }
    if (res.status >= 500 || res.status === 429) throw new CalendarOutcomeUnknownError(`Google create HTTP ${res.status}`);
    throw new CalendarUnavailableError(`Google create HTTP ${res.status}`);
  }

  async findByIdempotencyKey(input: { calendarId: string; idempotencyKey: string; around: string }): Promise<ExternalBookingRef | null> {
    const res = await this.request('GET', `/calendars/${encodeURIComponent(input.calendarId)}/events/${googleEventId(input.idempotencyKey)}`);
    if (res.status === 404 || res.status === 410) return null;
    if (!res.ok) throw new CalendarUnavailableError(`Google get HTTP ${res.status}`);
    const ev = (await res.json()) as { id: string; etag?: string; status?: string };
    return ev.status === 'cancelled' ? null : { externalId: ev.id, etag: ev.etag };
  }

  async moveBooking(input: { ref: ExternalBookingRef; calendarId: string; slot: Slot }): Promise<ExternalBookingRef> {
    const res = await this.request('PATCH', `/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.ref.externalId)}?sendUpdates=none`, {
      start: { dateTime: input.slot.start },
      end: { dateTime: input.slot.end },
    }).catch((e) => {
      throw new CalendarOutcomeUnknownError((e as Error).message);
    });
    if (!res.ok) throw res.status >= 500 ? new CalendarOutcomeUnknownError(`Google move HTTP ${res.status}`) : new CalendarUnavailableError(`Google move HTTP ${res.status}`);
    const ev = (await res.json()) as { id: string; etag?: string };
    return { externalId: ev.id, etag: ev.etag };
  }

  async cancelBooking(input: { ref: ExternalBookingRef; calendarId: string }): Promise<void> {
    const res = await this.request('DELETE', `/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.ref.externalId)}?sendUpdates=none`).catch((e) => {
      throw new CalendarUnavailableError((e as Error).message);
    });
    if (res.ok || res.status === 404 || res.status === 410) return; // already gone = cancelled
    throw new CalendarUnavailableError(`Google delete HTTP ${res.status}`);
  }
}

/** OAuth helpers (authorization-code flow with offline access for a refresh token). */
export function googleAuthUrl(opts: { clientId: string; redirectUri: string; state: string }): string {
  const p = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: opts.state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export async function exchangeGoogleCode(opts: { clientId: string; clientSecret: string; redirectUri: string; code: string; fetch?: typeof fetch }): Promise<{ refreshToken: string; accessToken: string; expiresIn: number; email: string | null; scopes: string[] }> {
  const res = await (opts.fetch ?? fetch)('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: opts.code, client_id: opts.clientId, client_secret: opts.clientSecret, redirect_uri: opts.redirectUri, grant_type: 'authorization_code' }),
  });
  const json = (await res.json()) as { refresh_token?: string; access_token?: string; expires_in?: number; id_token?: string; scope?: string; error?: string };
  if (!res.ok || !json.refresh_token || !json.access_token) throw new Error(`Google token exchange failed: ${json.error ?? res.status}`);
  let email: string | null = null;
  if (json.id_token) {
    try {
      email = JSON.parse(Buffer.from(json.id_token.split('.')[1]!, 'base64url').toString()).email ?? null; // from Google's TLS response; display only
    } catch {
      email = null;
    }
  }
  return { refreshToken: json.refresh_token, accessToken: json.access_token, expiresIn: json.expires_in ?? 3600, email, scopes: (json.scope ?? '').split(' ').filter(Boolean) };
}

/** Access tokens from a stored refresh token, cached until shortly before expiry. */
export class GoogleRefreshTokenProvider implements AccessTokenProvider {
  private cached: { token: string; exp: number } | null = null;
  constructor(private readonly opts: { clientId: string; clientSecret: string; getRefreshToken: () => Promise<string>; fetch?: typeof fetch; onRevoked?: () => Promise<void> }) {}
  async getAccessToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.cached && this.cached.exp > Date.now() + 60_000) return this.cached.token;
    const res = await (this.opts.fetch ?? fetch)('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.opts.clientId, client_secret: this.opts.clientSecret, refresh_token: await this.opts.getRefreshToken(), grant_type: 'refresh_token' }),
    });
    const json = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
    if (json.error === 'invalid_grant') {
      await this.opts.onRevoked?.();
      throw new CalendarUnavailableError('Google access was revoked; the business needs to reconnect its calendar');
    }
    if (!res.ok || !json.access_token) throw new CalendarUnavailableError(`Google token refresh failed: ${json.error ?? res.status}`);
    this.cached = { token: json.access_token, exp: Date.now() + (json.expires_in ?? 3600) * 1000 };
    return json.access_token;
  }
}
