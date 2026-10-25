import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Twilio request validation: base64(HMAC-SHA1(authToken, fullUrl + concatenated sorted POST params)).
 * Requests failing this check are rejected before any processing (forged-webhook defence).
 */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  return createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64');
}

export function isValidTwilioRequest(authToken: string, url: string, params: Record<string, string>, header: string | undefined): boolean {
  if (!header) return false;
  const expected = Buffer.from(twilioSignature(authToken, url, params));
  const got = Buffer.from(header);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

/** Short-lived token binding a media stream to the call we created (WebSocket upgrades are not form posts). */
export function streamToken(secret: string, callId: string, issuedAtSec = Math.floor(Date.now() / 1000)): string {
  const mac = createHmac('sha256', secret).update(`${callId}.${issuedAtSec}`).digest('base64url');
  return `${issuedAtSec}.${mac}`;
}

export function verifyStreamToken(secret: string, callId: string, token: string, maxAgeSec = 120, nowSec = Math.floor(Date.now() / 1000)): boolean {
  const [ts, mac] = token.split('.');
  const issued = Number(ts);
  if (!Number.isFinite(issued) || !mac || nowSec - issued > maxAgeSec || issued - nowSec > 30) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(`${callId}.${issued}`).digest('base64url'));
  const got = Buffer.from(mac);
  return expected.length === got.length && timingSafeEqual(expected, got);
}
