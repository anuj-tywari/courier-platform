
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z.string().min(1),
  ADMIN_API_TOKEN: z.string().optional().default(""),

  BULK_MAX_ORDERS: z.coerce.number().int().positive().max(1000).default(100),
  BULK_CONCURRENCY: z.coerce.number().int().positive().max(100).default(10),

  CORS_ALLOWED_ORIGINS: z.string().optional().default(""),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(120),

  URBANEBOLT_BASE_URL: z.string().url().optional(),
  URBANEBOLT_USERNAME: z.string().optional().default(""),
  URBANEBOLT_PASSWORD: z.string().optional().default(""),
  URBANEBOLT_CUSTOMER_CODE: z.string().optional().default(""),
  URBANEBOLT_DEFAULT_SERVICE_TYPE: z.string().optional().default("SDD"),
  URBANEBOLT_DEFAULT_RETURN_EMAIL: z.string().email().optional().default("integration@example.com"),
  URBANEBOLT_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  URBANEBOLT_RETRY_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  URBANEBOLT_RETRY_BASE_DELAY_MS: z.coerce.number().int().positive().default(300),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error("Invalid environment configuration:\n" + JSON.stringify(parsed.error.format(), null, 2));
    process.exit(1);
  }
  const env = parsed.data;

  if (env.NODE_ENV === "production") {
    const problems: string[] = [];
    if (!env.CORS_ALLOWED_ORIGINS) {
      problems.push("CORS_ALLOWED_ORIGINS must be set (comma-separated) in production, wildcard CORS is dev-only.");
    }
    if (!env.ADMIN_API_TOKEN) {
      problems.push("ADMIN_API_TOKEN must be set in production, the admin API manages courier credentials and must not be left open.");
    }
    if (problems.length) {
      // eslint-disable-next-line no-console
      console.error("Refusing to start in production with invalid config:\n- " + problems.join("\n- "));
      process.exit(1);
    }
  }

  return env;
}
