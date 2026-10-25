import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Fetching a URL a user typed is an SSRF risk: it could point at our own infrastructure.
 * Rules: http(s) only, standard ports, every hostname (including redirects) must resolve to public addresses,
 * bounded redirects, size and time. Robots.txt is respected by the caller.
 */
export class UnsafeUrlError extends Error {
  override name = 'UnsafeUrlError';
}

function isPrivateV4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number) as [number, number];
  return (
    a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || a >= 224 || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19))
  );
}

function isPrivateV6(ip: string): boolean {
  const x = ip.toLowerCase();
  if (x === '::1' || x === '::') return true;
  if (x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80')) return true;
  const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isPrivateV4(mapped[1]!) : false;
}

export function isPublicAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return !isPrivateV4(ip);
  if (v === 6) return !isPrivateV6(ip);
  return false;
}

export type Resolver = (host: string) => Promise<string[]>;
const defaultResolver: Resolver = async (host) => (await lookup(host, { all: true })).map((r) => r.address);

export async function assertPublicUrl(raw: string, resolve: Resolver = defaultResolver): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('Not a valid web address');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new UnsafeUrlError('Only http and https addresses are allowed');
  if (url.username || url.password) throw new UnsafeUrlError('Addresses with credentials are not allowed');
  if (url.port && !['80', '443'].includes(url.port)) throw new UnsafeUrlError('Non-standard ports are not allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new UnsafeUrlError('Internal addresses are not allowed');
  const addresses = isIP(host) ? [host] : await resolve(host);
  if (!addresses.length || !addresses.every(isPublicAddress)) throw new UnsafeUrlError('That address points to a private network');
  return url;
}

export interface SafeFetchOptions {
  fetch?: typeof fetch;
  resolve?: Resolver;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  userAgent?: string;
}

export async function safeFetchText(raw: string, o: SafeFetchOptions = {}): Promise<{ url: string; status: number; contentType: string; text: string }> {
  let current = raw;
  for (let i = 0; i <= (o.maxRedirects ?? 3); i++) {
    const url = await assertPublicUrl(current, o.resolve);
    const res = await (o.fetch ?? fetch)(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(o.timeoutMs ?? 8000),
      headers: { 'user-agent': o.userAgent ?? 'ReceptionSetupBot/1.0 (business details import; contact via website owner)', accept: 'text/html,text/plain;q=0.9' },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location')!, url).toString();
      continue;
    }
    const max = o.maxBytes ?? 1_500_000;
    const reader = res.body?.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > max) {
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
    }
    return { url: url.toString(), status: res.status, contentType: res.headers.get('content-type') ?? '', text: Buffer.concat(chunks).toString('utf8') };
  }
  throw new UnsafeUrlError('Too many redirects');
}

/** Minimal robots.txt check for our user agent (falls back to `*`). Unreachable robots.txt = allowed. */
export async function robotsAllows(siteUrl: URL, path: string, o: SafeFetchOptions = {}): Promise<boolean> {
  let text = '';
  try {
    const r = await safeFetchText(new URL('/robots.txt', siteUrl).toString(), { ...o, maxBytes: 200_000 });
    if (r.status >= 400) return true;
    text = r.text;
  } catch {
    return true;
  }
  const groups: Array<{ agents: string[]; disallow: string[]; allow: string[] }> = [];
  let cur: { agents: string[]; disallow: string[]; allow: string[] } | null = null;
  for (const line of text.split(/\r?\n/)) {
    const [k, ...rest] = line.replace(/#.*/, '').split(':');
    const key = k?.trim().toLowerCase();
    const val = rest.join(':').trim();
    if (!key) continue;
    if (key === 'user-agent') {
      if (!cur || cur.disallow.length || cur.allow.length) groups.push((cur = { agents: [], disallow: [], allow: [] }));
      cur.agents.push(val.toLowerCase());
    } else if (cur && key === 'disallow' && val) cur.disallow.push(val);
    else if (cur && key === 'allow' && val) cur.allow.push(val);
  }
  const g = groups.find((x) => x.agents.some((a) => a.includes('receptionsetupbot'))) ?? groups.find((x) => x.agents.includes('*'));
  if (!g) return true;
  const longest = (rules: string[]) => Math.max(-1, ...rules.filter((r) => path.startsWith(r)).map((r) => r.length));
  return longest(g.allow) >= longest(g.disallow);
}
