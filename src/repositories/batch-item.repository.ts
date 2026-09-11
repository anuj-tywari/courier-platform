import { pool } from "../db/client";
import { ShipmentStatus } from "../types/unified";

export interface BatchItemRow {
  id: string;
  batch_id: string;
  input_index: number;
  order_id: string;
  courier_partner: string;
  success: boolean | null;
  status: ShipmentStatus | "PENDING" | null;
  awb_number: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

class BatchItemRepository {
  async createMany(
    batchId: string,
    items: Array<{
      inputIndex: number;
      orderId: string;
      courierPartner: string;
      success?: boolean | null;
      status?: ShipmentStatus | "PENDING" | null;
      awbNumber?: string | null;
      errorCode?: string | null;
      errorMessage?: string | null;
    }>
  ): Promise<void> {
    if (!items.length) return;
    const now = new Date().toISOString();
    const values: string[] = [];
    const params: unknown[] = [];

    items.forEach((item, i) => {
      const offset = i * 10;
      values.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 10})`
      );
      params.push(
        batchId,
        item.inputIndex,
        item.orderId,
        item.courierPartner,
        item.success ?? null,
        item.status ?? "PENDING",
        item.awbNumber ?? null,
        item.errorCode ?? null,
        item.errorMessage ?? null,
        now
      );
    });

    await pool.query(
      `INSERT INTO batch_items
         (batch_id, input_index, order_id, courier_partner, success, status, awb_number, error_code, error_message, created_at, updated_at)
       VALUES ${values.join(", ")}`,
      params
    );
  }

  async markResult(
    batchId: string,
    inputIndex: number,
    result: {
      success: boolean;
      status: ShipmentStatus;
      awbNumber?: string | null;
      errorCode?: string | null;
      errorMessage?: string | null;
    }
  ): Promise<void> {
    await pool.query(
      `UPDATE batch_items SET
         success = $3,
         status = $4,
         awb_number = $5,
         error_code = $6,
         error_message = $7,
         updated_at = $8
       WHERE batch_id = $1 AND input_index = $2`,
      [
        batchId,
        inputIndex,
        result.success,
        result.status,
        result.awbNumber ?? null,
        result.errorCode ?? null,
        result.errorMessage ?? null,
        new Date().toISOString(),
      ]
    );
  }

  async listByBatch(batchId: string): Promise<BatchItemRow[]> {
    const res = await pool.query<BatchItemRow>(
      "SELECT * FROM batch_items WHERE batch_id = $1 ORDER BY input_index ASC",
      [batchId]
    );
    return res.rows;
  }
}

export const batchItemRepository = new BatchItemRepository();
