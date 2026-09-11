import "dotenv/config";
import { ready, pool } from "./client";
import { courierRegistry } from "../couriers/registry";

async function main() {
  await ready;
  await courierRegistry.initialize();
  // eslint-disable-next-line no-console
  console.log("Courier seed data applied.");
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Failed to seed database:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
