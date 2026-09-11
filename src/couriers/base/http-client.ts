
import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import { withRetry } from "../../utils/retry";
import { CourierClientError, CourierUnavailableError } from "../../types/errors";
import { logger } from "../../utils/logger";

interface CourierHttpOptions {
  baseURL: string;
  timeoutMs: number;
  retryMaxAttempts: number;
  retryBaseDelayMs: number;
  partnerId: string;
  displayName: string;
}

export class CourierHttpClient {
  private axios: AxiosInstance;
  constructor(private opts: CourierHttpOptions) {
    this.axios = axios.create({ baseURL: opts.baseURL, timeout: opts.timeoutMs });
  }

  async request<T = unknown>(cfg: AxiosRequestConfig): Promise<{ data: T; raw: unknown }> {
    return withRetry(
      async () => {
        try {
          const res = await this.axios.request<T>(cfg);
          return { data: res.data, raw: res.data };
        } catch (err: any) {
          if (err.response) {
            const status = err.response.status;
            if (status >= 400 && status < 500) {
              throw new CourierClientError(this.opts.displayName, err.response.data?.message || err.message, {
                status,
                body: err.response.data,
              });
            }
            throw new CourierUnavailableError(this.opts.displayName, `HTTP ${status}`, {
              status,
              body: err.response.data,
            });
          }
          throw new CourierUnavailableError(this.opts.displayName, err.code || err.message, { cause: err.message });
        }
      },
      {
        maxAttempts: this.opts.retryMaxAttempts,
        baseDelayMs: this.opts.retryBaseDelayMs,
        isRetryable: (err) => err instanceof CourierUnavailableError,
        onRetry: (attempt, err) => {
          logger.warn(
            { courier_partner: this.opts.partnerId, attempt, error: (err as Error).message },
            "retrying courier request after transient failure"
          );
        },
      }
    );
  }
}
