import { OrderRow } from "../repositories/order.repository";
import { TrackingEventRow } from "../repositories/tracking.repository";
import { OrderResult, TrackResult } from "../types/unified";

export function toOrderResult(order: OrderRow): OrderResult {
  return {
    order_id: order.order_id,
    courier_partner: order.courier_partner,
    courier_order_id: order.courier_order_id,
    awb_number: order.awb_number,
    status: order.status,
    failure_reason: order.failure_reason,
    created_at: order.created_at,
    updated_at: order.updated_at,
  };
}

export function toTrackResult(order: OrderRow, events: TrackingEventRow[]): TrackResult {
  return {
    ...toOrderResult(order),
    history: events.map((e) => ({
      status: e.status,
      source: e.source,
      occurred_at: e.created_at,
    })),
  };
}
