import { pool, Queryable } from "../db/client";
import { CreateOrderRequest, ShipmentStatus } from "../types/unified";

export interface OrderRow {
  id: string;
  order_id: string;
  courier_partner: string;
  courier_order_id: string | null;
  awb_number: string | null;
  status: ShipmentStatus;
  failure_reason: string | null;
  normalized_request: CreateOrderRequest;
  courier_request_payload: unknown | null;
  courier_response_payload: unknown | null;
  batch_id: string | null;
  created_at: string;
  updated_at: string;
}

interface CreateOrderRow {
  orderId: string;
  courierPartner: string;
  normalizedRequest: CreateOrderRequest;
  batchId?: string;
}

const UNIQUE_VIOLATION = "23505";

class OrderRepository {
  async createIfNotExists(row: CreateOrderRow): Promise<{ order: OrderRow; alreadyExisted: boolean }> {
    const existing = await this.findByOrderId(row.orderId);
    if (existing) return { order: existing, alreadyExisted: true };

    const now = new Date().toISOString();
    try {
      await pool.query(
        `INSERT INTO orders (order_id, courier_partner, status, normalized_request, batch_id, created_at, updated_at)
         VALUES ($1, $2, 'PENDING', $3, $4, $5, $5)`,
        [row.orderId, row.courierPartner, JSON.stringify(row.normalizedRequest), row.batchId ?? null, now]
      );
    } catch (err: any) {
      if (err.code !== UNIQUE_VIOLATION) throw err;
      const order = (await this.findByOrderId(row.orderId))!;
      return { order, alreadyExisted: true };
    }
    const order = (await this.findByOrderId(row.orderId))!;
    return { order, alreadyExisted: false };
  }

  async findByOrderId(orderId: string): Promise<OrderRow | undefined> {
    const res = await pool.query<OrderRow>("SELECT * FROM orders WHERE order_id = $1", [orderId]);
    return res.rows[0];
  }

  async markResult(
    params: {
      orderId: string;
      status: ShipmentStatus;
      courierOrderId?: string | null;
      awbNumber?: string | null;
      failureReason?: string | null;
      courierRequestPayload?: unknown;
      courierResponsePayload?: unknown;
    },
    db: Queryable = pool
  ): Promise<OrderRow> {
    const res = await db.query<OrderRow>(
      `UPDATE orders SET
         status = $2,
         courier_order_id = COALESCE($3, courier_order_id),
         awb_number = COALESCE($4, awb_number),
         failure_reason = $5,
         courier_request_payload = COALESCE($6, courier_request_payload),
         courier_response_payload = COALESCE($7, courier_response_payload),
         updated_at = $8
       WHERE order_id = $1
       RETURNING *`,
      [
        params.orderId,
        params.status,
        params.courierOrderId ?? null,
        params.awbNumber ?? null,
        params.failureReason ?? null,
        params.courierRequestPayload != null ? JSON.stringify(params.courierRequestPayload) : null,
        params.courierResponsePayload != null ? JSON.stringify(params.courierResponsePayload) : null,
        new Date().toISOString(),
      ]
    );
    return res.rows[0];
  }

  async listByBatch(batchId: string): Promise<OrderRow[]> {
    const res = await pool.query<OrderRow>("SELECT * FROM orders WHERE batch_id = $1 ORDER BY created_at ASC", [batchId]);
    return res.rows;
  }
}

export const orderRepository = new OrderRepository();
