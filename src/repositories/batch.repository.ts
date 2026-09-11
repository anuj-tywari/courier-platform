import { pool } from "../db/client";

interface BatchRow {
  id: string;
  status: "PROCESSING" | "COMPLETED";
  total_orders: number;
  succeeded: number;
  failed: number;
  created_at: string;
  updated_at: string;
}

class BatchRepository {
  async create(totalOrders: number, initialFailed = 0): Promise<BatchRow> {
    const now = new Date().toISOString();
    const res = await pool.query<BatchRow>(
      `INSERT INTO batches (status, total_orders, succeeded, failed, created_at, updated_at)
       VALUES ('PROCESSING', $1, 0, $2, $3, $3)
       RETURNING *`,
      [totalOrders, initialFailed, now]
    );
    return res.rows[0];
  }

  async incrementResult(batchId: string, success: boolean): Promise<void> {
    const column = success ? "succeeded" : "failed";
    await pool.query(`UPDATE batches SET ${column} = ${column} + 1, updated_at = $2 WHERE id = $1`, [
      batchId,
      new Date().toISOString(),
    ]);
  }

  async markCompleted(batchId: string): Promise<void> {
    await pool.query("UPDATE batches SET status = 'COMPLETED', updated_at = $2 WHERE id = $1", [
      batchId,
      new Date().toISOString(),
    ]);
  }

  async findById(batchId: string): Promise<BatchRow | undefined> {
    const res = await pool.query<BatchRow>("SELECT * FROM batches WHERE id = $1", [batchId]);
    return res.rows[0];
  }
}

export const batchRepository = new BatchRepository();
