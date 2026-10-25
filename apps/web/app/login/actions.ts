'use server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { publicEnv } from '@/lib/env';

export type LoginState = { status: 'idle' | 'sent' | 'error'; message?: string };

export async function sendSignInLink(_: LoginState, form: FormData): Promise<LoginState> {
  const email = z.string().email().safeParse(form.get('email'));
  if (!email.success) return { status: 'error', message: 'Enter the email address you were invited with.' };
  const sb = await supabaseServer();
  // Invite-only: accounts are created by an operator or a business owner, never by self sign-up here.
  const { error } = await sb.auth.signInWithOtp({
    email: email.data,
    options: { shouldCreateUser: false, emailRedirectTo: `${publicEnv().NEXT_PUBLIC_SITE_URL}/auth/callback` },
  });
  // Same response whether or not the account exists, so this form cannot be used to discover accounts.
  if (error && !/not found|signups not allowed/i.test(error.message)) {
    return { status: 'error', message: 'We could not send the link. Wait a minute and try again.' };
  }
  return { status: 'sent' };
}
