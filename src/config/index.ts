import "dotenv/config";
import { loadEnv } from "./env.schema";

export const env = loadEnv();

export const config = {
  port: env.PORT,
  nodeEnv: env.NODE_ENV,
  isProduction: env.NODE_ENV === "production",
  adminApiToken: env.ADMIN_API_TOKEN,
  corsAllowedOrigins: env.CORS_ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
  rateLimit: {
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    maxRequests: env.RATE_LIMIT_MAX_REQUESTS,
  },
  bulk: {
    maxOrders: env.BULK_MAX_ORDERS,
    concurrency: env.BULK_CONCURRENCY,
  },
  urbanebolt: {
    baseUrl: env.URBANEBOLT_BASE_URL || "https://uat.urbanebolt.in/api/v1",
    username: env.URBANEBOLT_USERNAME,
    password: env.URBANEBOLT_PASSWORD,
    customerCode: env.URBANEBOLT_CUSTOMER_CODE,
    defaultServiceType: env.URBANEBOLT_DEFAULT_SERVICE_TYPE,
    defaultReturnEmail: env.URBANEBOLT_DEFAULT_RETURN_EMAIL,
    timeoutMs: env.URBANEBOLT_TIMEOUT_MS,
    retryMaxAttempts: env.URBANEBOLT_RETRY_MAX_ATTEMPTS,
    retryBaseDelayMs: env.URBANEBOLT_RETRY_BASE_DELAY_MS,
  },
};
