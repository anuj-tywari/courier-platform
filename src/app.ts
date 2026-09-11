import express from "express";
import path from "path";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { logger } from "./utils/logger";
import { requestId } from "./middleware/request-id";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";
import { apiRateLimiter } from "./middleware/rate-limit";
import { apiV1Router } from "./routes";
import { config } from "./config";
import { pool } from "./db/client";

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);

  app.use(helmet());
  app.use(
    cors(
      config.corsAllowedOrigins.length
        ? { origin: config.corsAllowedOrigins }
        : {} // dev default: reflect request origin -- production requires an explicit allowlist, enforced in env.schema.ts
    )
  );
  app.use(express.json({ limit: "2mb" }));
  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      customProps: (req) => ({ request_id: (req as any).requestId }),
      redact: ["req.headers.authorization", "req.headers.cookie", "req.body.courier_partner_secret"],
    })
  );

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.get("/ready", async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ status: "ready" });
    } catch (err) {
      logger.error({ err }, "readiness check failed");
      res.status(503).json({ status: "not_ready" });
    }
  });

  app.use("/api/v1", apiRateLimiter, apiV1Router);

  app.use("/admin", express.static(path.join(__dirname, "../public/admin")));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
