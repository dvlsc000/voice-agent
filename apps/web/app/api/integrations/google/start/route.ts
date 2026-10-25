import { NextResponse, type NextRequest } from 'next/server';
import { googleAuthUrl } from '@vp/server';
import { requireMembership } from '@/lib/auth';
import { googleOAuthConfig, publicEnv } from '@/lib/env';
import { signState } from '@/lib/oauth-state';

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get('org') ?? '';
  const m = await requireMembership(slug, ['owner', 'manager']);
  const cfg = googleOAuthConfig();
  if (!cfg) return NextResponse.redirect(new URL(`/app/${slug}/settings?calendar=unavailable`, request.url));
  const { getUser } = await import('@/lib/auth');
  const user = await getUser();
  const { state, nonce } = signState(cfg.stateSecret, { org: m.organizationId, uid: user!.id });
  const res = NextResponse.redirect(googleAuthUrl({ clientId: cfg.clientId, redirectUri: `${publicEnv().NEXT_PUBLIC_SITE_URL}/api/integrations/google/callback`, state }));
  res.cookies.set('oauth_nonce', nonce, { httpOnly: true, secure: true, sameSite: 'lax', path: '/api/integrations', maxAge: 600 });
  return res;
}
