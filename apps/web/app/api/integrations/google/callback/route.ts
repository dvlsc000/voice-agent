import { NextResponse, type NextRequest } from 'next/server';
import { VaultSecretStore, exchangeGoogleCode, saveCalendarConnection } from '@vp/server';
import { getMemberships, getUser } from '@/lib/auth';
import { serverDb } from '@/lib/db';
import { googleOAuthConfig, publicEnv } from '@/lib/env';
import { verifyState } from '@/lib/oauth-state';

export async function GET(request: NextRequest) {
  const cfg = googleOAuthConfig();
  const user = await getUser();
  const p = request.nextUrl.searchParams;
  const state = cfg ? verifyState(cfg.stateSecret, p.get('state') ?? '', request.cookies.get('oauth_nonce')?.value) : null;
  // The signed-in user must be the one who started the flow and still be an owner/manager of that business.
  const m = state && user && state.uid === user.id ? (await getMemberships()).find((x) => x.organizationId === state.org && (x.role === 'owner' || x.role === 'manager')) : null;
  if (!cfg || !state || !m) return NextResponse.redirect(new URL('/app?calendar=failed', request.url));
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`/app/${m.slug}/settings?calendar=${q}`, request.url));
    res.cookies.delete({ name: 'oauth_nonce', path: '/api/integrations' });
    return res;
  };
  if (p.get('error') || !p.get('code')) return back('cancelled');
  try {
    const t = await exchangeGoogleCode({ clientId: cfg.clientId, clientSecret: cfg.clientSecret, redirectUri: `${publicEnv().NEXT_PUBLIC_SITE_URL}/api/integrations/google/callback`, code: p.get('code')! });
    const db = serverDb();
    await saveCalendarConnection(db, new VaultSecretStore(db), { organizationId: m.organizationId, provider: 'google_calendar', refreshToken: t.refreshToken, accountLabel: t.email, scopes: t.scopes, actorUserId: user!.id });
    return back('connected');
  } catch {
    return back('failed');
  }
}
