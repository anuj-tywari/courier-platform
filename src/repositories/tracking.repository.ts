import { pool, Queryable } from "../db/client";
import { ShipmentStatus } from "../types/unified";

export interface TrackingEventRow {
  id: string;
  order_id: string;
  status: ShipmentStatus;
  raw_payload: unknown;
  source: string;
  created_at: string;
}

class TrackingRepository {
  async append(orderId: string, status: ShipmentStatus, rawPayload: unknown, source: string, db: Queryable = pool): Promise<void> {
    await db.query(
      `INSERT INTO tracking_events (order_id, status, raw_payload, source, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [orderId, status, JSON.stringify(rawPayload), source, new Date().toISOString()]
    );
  }

  async listForOrder(orderId: string): Promise<TrackingEventRow[]> {
    const res = await pool.query<TrackingEventRow>(
      "SELECT * FROM tracking_events WHERE order_id = $1 ORDER BY created_at ASC",
      [orderId]
    );
    return res.rows;
  }
}

export const trackingRepository = new TrackingRepository();
