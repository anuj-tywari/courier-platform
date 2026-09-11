import "dotenv/config";
import fs from "fs";
import path from "path";
import { Pool } from "pg";
import { config } from "../config";

export async function runMigrations(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const migrationsDir = path.join(__dirname, "migrations");
  const files = fs.readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();

  for (const file of files) {
    const existing = await pool.query("SELECT 1 FROM schema_migrations WHERE filename = $1", [file]);
    if (existing.rowCount) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: Math.max(20, config.bulk.concurrency + 10) });
  try {
    await runMigrations(pool);
    // eslint-disable-next-line no-console
    console.log("Database migrations applied.");
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Failed to apply migrations:", err);
    process.exit(1);
  });
}
