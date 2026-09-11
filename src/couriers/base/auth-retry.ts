
import { CourierClientError } from "../../types/errors";

export async function withAuthRetry<T>(opts: {
  authenticate: () => Promise<void>;
  invalidateToken: () => void;
  canReauth: boolean;
  fn: () => Promise<T>;
}): Promise<T> {
  await opts.authenticate();
  try {
    return await opts.fn();
  } catch (err) {
    const isAuthFailure = err instanceof CourierClientError && (err.details as any)?.status === 401;
    if (!isAuthFailure || !opts.canReauth) throw err;
    opts.invalidateToken();
    await opts.authenticate();
    return await opts.fn();
  }
}
