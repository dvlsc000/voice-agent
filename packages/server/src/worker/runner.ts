import type { Db } from '../db';

export interface Job {
  id: number;
  kind: string;
  organization_id: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

export type JobHandler = (job: Job) => Promise<void>;

/** Thrown by a handler when retrying cannot help (bad data, permanent provider rejection). */
export class NonRetryableJobError extends Error {
  override name = 'NonRetryableJobError';
}

export interface RunResult {
  claimed: number;
  succeeded: number;
  failed: number;
  dead: number;
}

/**
 * Claims a batch of due jobs (FOR UPDATE SKIP LOCKED, so many workers can run safely) and executes them.
 * Success → 'succeeded'. Error → exponential backoff via private.fail_job; after max_attempts → 'dead'
 * (visible on the operator console). Unknown kinds are dead-lettered immediately.
 */
export async function runJobsOnce(db: Db, handlers: Record<string, JobHandler>, workerId: string, limit = 20, queue = 'default'): Promise<RunResult> {
  const { rows } = await db.query<Job>(`select * from private.claim_jobs($1, $2, $3)`, [queue, workerId, limit]);
  const result: RunResult = { claimed: rows.length, succeeded: 0, failed: 0, dead: 0 };
  for (const job of rows) {
    const handler = handlers[job.kind];
    try {
      if (!handler) throw new NonRetryableJobError(`No handler for job kind "${job.kind}"`);
      await handler(job);
      await db.query(`update public.jobs set status = 'succeeded', finished_at = now(), locked_at = null, locked_by = null where id = $1`, [job.id]);
      result.succeeded++;
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      if (e instanceof NonRetryableJobError) {
        await db.query(`update public.jobs set status = 'dead', last_error = left($2, 2000), finished_at = now(), locked_at = null, locked_by = null where id = $1`, [job.id, msg]);
        result.dead++;
      } else {
        await db.query(`select private.fail_job($1, $2)`, [job.id, msg]);
        const { rows: s } = await db.query(`select status from public.jobs where id = $1`, [job.id]);
        if (s[0]?.status === 'dead') result.dead++;
        else result.failed++;
      }
    }
  }
  return result;
}

/**
 * Enqueue periodic maintenance jobs once per time bucket (dedupe key = kind + bucket),
 * so any number of workers calling this concurrently creates each job exactly once.
 */
export async function schedulePeriodicJobs(db: Db, now = new Date()): Promise<void> {
  const minute = now.toISOString().slice(0, 16);
  const fiveMin = new Date(Math.floor(now.getTime() / 300_000) * 300_000).toISOString().slice(0, 16);
  const hour = now.toISOString().slice(0, 13);
  const day = now.toISOString().slice(0, 10);
  const jobs: Array<[string, string]> = [
    ['sweep_bookings', `sweep_bookings:${minute}`],
    ['rollup_usage', `rollup_usage:${fiveMin}`],
    ['report_usage_stripe', `report_usage_stripe:${fiveMin}`],
    ['apply_retention', `apply_retention:${hour}`],
    ['queue_reminders', `queue_reminders:${hour}`],
    ['queue_daily_summaries', `queue_daily_summaries:${day}`],
  ];
  for (const [kind, key] of jobs) {
    await db.query(`insert into public.jobs (kind, dedupe_key, max_attempts) values ($1, $2, 3) on conflict (dedupe_key) do nothing`, [kind, key]);
  }
}
