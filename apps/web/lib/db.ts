import 'server-only';
import { Db } from '@vp/server';
import { serverEnv } from './env';

const g = globalThis as unknown as { __vpDb?: Db };

/** Privileged server DB (bypasses RLS). Only use after an explicit authorization check in lib/auth.ts. */
export function serverDb(): Db {
  g.__vpDb ??= Db.fromUrl(serverEnv().DATABASE_URL, 5);
  return g.__vpDb;
}
