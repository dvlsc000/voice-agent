import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** OAuth `state`: signed, short-lived, bound to the user, the organization and a browser cookie (CSRF). */
export interface OAuthState {
  org: string;
  uid: string;
  nonce: string;
  exp: number;
}

export function signState(secret: string, s: Omit<OAuthState, 'nonce' | 'exp'>): { state: string; nonce: string } {
  const nonce = randomBytes(16).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ ...s, nonce, exp: Date.now() + 10 * 60_000 })).toString('base64url');
  const mac = createHmac('sha256', secret).update(payload).digest('base64url');
  return { state: `${payload}.${mac}`, nonce };
}

export function verifyState(secret: string, state: string, cookieNonce: string | undefined): OAuthState | null {
  const [payload, mac] = state.split('.');
  if (!payload || !mac || !cookieNonce) return null;
  const expected = Buffer.from(createHmac('sha256', secret).update(payload).digest('base64url'));
  const got = Buffer.from(mac);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  const s = JSON.parse(Buffer.from(payload, 'base64url').toString()) as OAuthState;
  if (s.exp < Date.now() || s.nonce !== cookieNonce) return null;
  return s;
}
