export interface RetryOptions {
  attempts: number;
  delayMs: number;
  onRetry?: (attempt: number, error: unknown) => void;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    try {
      return fn();
    } catch (err) {
      lastError = err;
      opts.onRetry?.(attempt, err);
      if (attempt < opts.attempts) await sleep(opts.delayMs);
    }
  }
  throw lastError;
}
