import { z } from 'zod';

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(10),
  NEXT_PUBLIC_SITE_URL: z.string().url().default('http://localhost:3000'),
  NEXT_PUBLIC_BRAND_NAME: z.string().default('Reception'),
});

/** Validated at first use so a misconfigured deploy fails loudly instead of half-working. */
export function publicEnv() {
  return publicSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_BRAND_NAME: process.env.NEXT_PUBLIC_BRAND_NAME,
  });
}

export function serverEnv() {
  if (typeof window !== 'undefined') throw new Error('serverEnv() called in the browser');
  return z.object({ DATABASE_URL: z.string().startsWith('postgres') }).parse({ DATABASE_URL: process.env.DATABASE_URL });
}

export const brandName = () => process.env.NEXT_PUBLIC_BRAND_NAME ?? 'Reception';

/** Optional: Supabase secret key, used only to send invitation emails from the operator console. */
export function supabaseSecretKey(): string | null {
  if (typeof window !== 'undefined') throw new Error('server only');
  return process.env.SUPABASE_SECRET_KEY || null;
}

/** Optional AI model connection for running assistant test calls from the operator console. */
export function llmConfig(): { baseUrl: string; apiKey: string; model: string; authHeader: 'bearer' | 'api-key' } | null {
  if (typeof window !== 'undefined') throw new Error('server only');
  const { LLM_BASE_URL, LLM_API_KEY, LLM_MODEL, LLM_AUTH_HEADER } = process.env;
  if (!LLM_BASE_URL || !LLM_API_KEY) return null;
  return { baseUrl: LLM_BASE_URL, apiKey: LLM_API_KEY, model: LLM_MODEL ?? 'mistral-small-latest', authHeader: LLM_AUTH_HEADER === 'api-key' ? 'api-key' : 'bearer' };
}
