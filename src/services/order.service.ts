import { courierRegistry } from "../couriers/registry";
import { orderRepository } from "../repositories/order.repository";
import { trackingRepository } from "../repositories/tracking.repository";
import { withTransaction } from "../db/client";
import { CreateOrderRequest, OrderResult, TrackResult, CancelResult } from "../types/unified";
import { toOrderResult, toTrackResult } from "./mapper";
import { AppError, ErrorCode } from "../types/errors";
import { logFailure } from "../utils/logger";

export class OrderService {
  async createOrder(input: CreateOrderRequest, opts: { batchId?: string; requestId?: string } = {}): Promise<OrderResult> {
    const adapter = courierRegistry.get(input.courier_partner); // throws if unknown/disabled

    const { order, alreadyExisted } = await orderRepository.createIfNotExists({
      orderId: input.order_id,
      courierPartner: adapter.partnerId,
      normalizedRequest: input,
      batchId: opts.batchId,
    });

    if (alreadyExisted) {
      if (order.courier_partner !== adapter.partnerId) {
        throw new AppError(
          ErrorCode.DUPLICATE_ORDER,
          `order_id "${input.order_id}" already exists with courier_partner "${order.courier_partner}"`,
          { existing_courier_partner: order.courier_partner }
        );
      }
      return toOrderResult(order);
    }

    try {
      const result = await adapter.createOrder(input);

      const updated = await withTransaction(async (db) => {
        const row = await orderRepository.markResult(
          {
            orderId: input.order_id,
            status: result.status,
            courierOrderId: result.courierOrderId,
            awbNumber: result.awbNumber,
            courierRequestPayload: result.rawRequest,
            courierResponsePayload: result.rawResponse,
          },
          db
        );
        await trackingRepository.append(input.order_id, result.status, result.rawResponse, "create_response", db);
        return row;
      });

      return toOrderResult(updated);
    } catch (err) {
      const failureReason = err instanceof AppError ? err.message : (err as Error).message;
      const courierBody = err instanceof AppError ? (err.details as any)?.body : undefined;
      await withTransaction(async (db) => {
        await orderRepository.markResult({ orderId: input.order_id, status: "FAILED", failureReason, courierResponsePayload: courierBody }, db);
        await trackingRepository.append(input.order_id, "FAILED", { error: failureReason, courier_response: courierBody ?? null }, "create_failure", db);
      });

      logFailure({
        orderId: input.order_id,
        courierPartner: adapter.partnerId,
        requestId: opts.requestId,
        errorType: err instanceof AppError ? err.code : "UNEXPECTED_ERROR",
        message: failureReason,
        stack: (err as Error).stack,
      });

      if (err instanceof AppError) throw err;
      throw new AppError(ErrorCode.INTERNAL_ERROR, "Unexpected error creating order");
    }
  }

  async trackOrder(orderId: string, opts: { requestId?: string } = {}): Promise<TrackResult> {
    const order = await orderRepository.findByOrderId(orderId);
    if (!order) throw new AppError(ErrorCode.ORDER_NOT_FOUND, `No order found for order_id "${orderId}"`);

    if (!order.awb_number) {
      const events = await trackingRepository.listForOrder(orderId);
      return toTrackResult(order, events);
    }

    const adapter = courierRegistry.get(order.courier_partner);
    try {
      const result = await adapter.trackShipment(order.courier_order_id || "", order.awb_number);
      const updated = await withTransaction(async (db) => {
        const row = await orderRepository.markResult({ orderId, status: result.status }, db);
        await trackingRepository.append(orderId, result.status, result.rawResponse, "courier_poll", db);
        return row;
      });
      const events = await trackingRepository.listForOrder(orderId);
      return toTrackResult(updated, events);
    } catch (err) {
      logFailure({
        orderId,
        courierPartner: adapter.partnerId,
        requestId: opts.requestId,
        errorType: err instanceof AppError ? err.code : "UNEXPECTED_ERROR",
        message: (err as Error).message,
        stack: (err as Error).stack,
      });
      if (err instanceof AppError) throw err;
      throw new AppError(ErrorCode.INTERNAL_ERROR, "Unexpected error tracking order");
    }
  }

  async cancelOrder(orderId: string, opts: { requestId?: string } = {}): Promise<CancelResult> {
    const order = await orderRepository.findByOrderId(orderId);
    if (!order) throw new AppError(ErrorCode.ORDER_NOT_FOUND, `No order found for order_id "${orderId}"`);

    if (!order.awb_number) {
      await withTransaction(async (db) => {
        await orderRepository.markResult({ orderId, status: "CANCELLED" }, db);
        await trackingRepository.append(orderId, "CANCELLED", { reason: "cancelled before courier acceptance" }, "cancel_response", db);
      });
      return { order_id: orderId, status: "CANCELLED", cancelled: true };
    }

    const adapter = courierRegistry.get(order.courier_partner);
    try {
      const result = await adapter.cancelOrder(order.courier_order_id || "", order.awb_number);
      await withTransaction(async (db) => {
        await orderRepository.markResult({ orderId, status: result.status }, db);
        await trackingRepository.append(orderId, result.status, result.rawResponse, "cancel_response", db);
      });
      return { order_id: orderId, status: result.status, cancelled: result.cancelled };
    } catch (err) {
      logFailure({
        orderId,
        courierPartner: adapter.partnerId,
        requestId: opts.requestId,
        errorType: err instanceof AppError ? err.code : "UNEXPECTED_ERROR",
        message: (err as Error).message,
        stack: (err as Error).stack,
      });
      if (err instanceof AppError) throw err;
      throw new AppError(ErrorCode.INTERNAL_ERROR, "Unexpected error cancelling order");
    }
  }
}

export const orderService = new OrderService();
