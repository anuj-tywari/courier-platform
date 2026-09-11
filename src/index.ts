import { createApp } from "./app";
import { config } from "./config";
import { logger } from "./utils/logger";
import { pool, ready } from "./db/client";
import { courierRegistry } from "./couriers/registry";

async function main() {
  await ready;
  await courierRegistry.initialize(); // seed code adapters + load DB-driven couriers

  const app = createApp();

  const server = app.listen(config.port, () => {
    logger.info(`courier-integration-platform listening on :${config.port} (${config.nodeEnv})`);
  });

  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "unhandled promise rejection");
  });
  process.on("uncaughtException", (err) => {
    logger.error({ err }, "uncaught exception");
    process.exit(1);
  });

  function shutdown(signal: string) {
    logger.info(`received ${signal}, shutting down gracefully`);
    server.close(async (err) => {
      if (err) {
        logger.error({ err }, "error during HTTP server close");
        process.exitCode = 1;
      }
      try {
        await pool.end();
      } catch (dbErr) {
        logger.error({ err: dbErr }, "error closing database pool");
      }
      process.exit();
    });

    setTimeout(() => {
      logger.warn("forcing shutdown after timeout");
      process.exit(1);
    }, 10_000).unref();
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal error during startup:", err);
  process.exit(1);
});
