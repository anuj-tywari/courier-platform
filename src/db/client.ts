import { Pool, PoolClient, types } from "pg";
import { config } from "../config";
import { runMigrations } from "./migrate";

types.setTypeParser(1184, (value) => new Date(value).toISOString());

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  // eslint-disable-next-line no-console
  console.error("DATABASE_URL is required (postgres connection string). See .env.example.");
  process.exit(1);
}

export const pool = new Pool({ connectionString, max: Math.max(20, config.bulk.concurrency + 10) });

export const ready = runMigrations(pool).catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Failed to apply database migrations:", err);
  process.exit(1);
});

export type Queryable = Pick<Pool | PoolClient, "query">;

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
