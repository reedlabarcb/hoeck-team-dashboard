/**
 * Retry + bounded-concurrency helpers for the RealNex mirror sync (P3.4).
 *
 * RealNex publishes no documented rate limit, so the ~1,275-call inversion walk is the
 * risky part. Strategy (approved design):
 *   - bounded concurrency, default 5, tunable at RUNTIME via REALNEX_SYNC_CONCURRENCY
 *     (change the Railway env var + re-kick — never redeploy into a running worker)
 *   - exponential backoff + jitter on 429 / 5xx (withRetry)
 *   - the caller decides log-and-skip vs fatal (withRetry rethrows after the last try)
 */

import { RealNexApiError } from './client';

export const DEFAULT_CONCURRENCY = 5;

/**
 * Effective concurrency from REALNEX_SYNC_CONCURRENCY (default 5), clamped to [1, 20].
 * Runtime-read so a mid-incident retune is an env-var change + re-kick, NOT a redeploy
 * (a redeploy would kill the in-process worker — the exact trap we've hit before).
 */
export function resolveConcurrency(): number {
  const raw = process.env.REALNEX_SYNC_CONCURRENCY;
  const n = raw ? Number(raw) : DEFAULT_CONCURRENCY;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_CONCURRENCY;
  return Math.min(20, Math.floor(n));
}

/** A transient RealNex response worth retrying: 429 (rate limit) or any 5xx. */
export function isRetryable(err: unknown): boolean {
  return err instanceof RealNexApiError && (err.status === 429 || err.status >= 500);
}

/** Specifically a 429 — callers count these into rate_limit_hits for tuning. */
export function isRateLimit(err: unknown): boolean {
  return err instanceof RealNexApiError && err.status === 429;
}

export interface RetryOptions {
  /** total attempts including the first (default 5). */
  attempts?: number;
  /** base backoff in ms (default 1000): delay = base * 2^(attempt-1), capped at maxDelayMs. */
  baseDelayMs?: number;
  /** backoff ceiling in ms (default 16000). */
  maxDelayMs?: number;
  /** fired once per retryable failure BEFORE sleeping — used to count 429s. */
  onRetry?: (err: unknown, attempt: number) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Run `fn` with exponential backoff + jitter on retryable (429/5xx) errors.
 * Non-retryable errors throw immediately. After the final attempt the last error rethrows,
 * so the caller can log-and-skip (catch) or treat it as fatal.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 5;
  const base = opts.baseDelayMs ?? 1000;
  const max = opts.maxDelayMs ?? 16_000;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === attempts) throw err;
      opts.onRetry?.(err, attempt);
      const backoff = Math.min(max, base * 2 ** (attempt - 1));
      const jitter = Math.floor(Math.random() * base); // 0..base ms, decorrelates parallel workers
      await sleep(backoff + jitter);
    }
  }
  throw lastErr;
}

/**
 * Map over `items` with at most `limit` promises in flight. Preserves input order in the
 * result. A worker that throws rejects the whole call — callers that want log-and-skip must
 * catch inside `fn` and return a sentinel (the sync does exactly that in its linking phase).
 */
export async function mapLimit<TIn, TOut>(
  items: TIn[],
  limit: number,
  fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
  const results = new Array<TOut>(items.length);
  const n = Math.max(1, Math.min(limit, items.length || 1));
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}
