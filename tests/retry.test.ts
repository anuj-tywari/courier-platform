import { describe, it, expect, vi } from "vitest";
import { withRetry } from "../src/utils/retry";

describe("withRetry", () => {
  it("returns the result on first success without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1, isRetryable: () => true });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries retryable failures up to maxAttempts, then succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce("recovered");

    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1, isRetryable: () => true });
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws immediately for a non-retryable error, without retrying", async () => {
    class ClientError extends Error {}
    const fn = vi.fn().mockRejectedValue(new ClientError("bad request"));

    await expect(
      withRetry(fn, { maxAttempts: 3, baseDelayMs: 1, isRetryable: (err) => !(err instanceof ClientError) })
    ).rejects.toThrow("bad request");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("gives up after maxAttempts and throws the last error", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fails"));
    await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 1, isRetryable: () => true })).rejects.toThrow(
      "always fails"
    );
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
