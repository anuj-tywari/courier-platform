
interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  isRetryable: (err: unknown) => boolean;
  onRetry?: (attempt: number, err: unknown) => void;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isLastAttempt = attempt === opts.maxAttempts;
      if (isLastAttempt || !opts.isRetryable(err)) {
        throw err;
      }
      opts.onRetry?.(attempt, err);
      const exp = opts.baseDelayMs * Math.pow(2, attempt - 1);
      const jitter = exp * 0.2 * (Math.random() * 2 - 1);
      await sleep(Math.max(0, exp + jitter));
    }
  }
  throw lastErr;
}
