
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost:5432/courier_platform_test";
process.env.NODE_ENV = "test";
process.env.ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN || "test-admin-token";

export async function resetDb() {
  const { pool, ready } = await import("../../src/db/client");
  await ready;
  await pool.query("TRUNCATE batch_items, orders, tracking_events, batches, courier_partners RESTART IDENTITY CASCADE");
}

export async function bootApp() {
  const { pool, ready } = await import("../../src/db/client");
  await ready;
  await pool.query("TRUNCATE batch_items, orders, tracking_events, batches, courier_partners RESTART IDENTITY CASCADE");

  const { courierRegistry } = await import("../../src/couriers/registry");
  await courierRegistry.initialize();

  const { createApp } = await import("../../src/app");
  return createApp();
}
