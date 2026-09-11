import pLimit from "p-limit";
import { orderService } from "./order.service";
import { batchRepository } from "../repositories/batch.repository";
import { batchItemRepository } from "../repositories/batch-item.repository";
import { config } from "../config";
import { CreateOrderRequest, BulkOrderItemResult, BulkSubmitResponse, BatchStatusResponse } from "../types/unified";
import { AppError, ErrorCode } from "../types/errors";
import { logFailure } from "../utils/logger";

interface AcceptedBulkItem {
  inputIndex: number;
  order: CreateOrderRequest;
}

export class BulkService {
  async submitBatch(orders: CreateOrderRequest[], opts: { requestId?: string } = {}): Promise<BulkSubmitResponse> {
    const rejected: BulkOrderItemResult[] = [];
    const accepted: AcceptedBulkItem[] = [];
    const batchItems: Parameters<typeof batchItemRepository.createMany>[1] = [];

    const seenInThisRequest = new Set<string>();
    for (const [inputIndex, o] of orders.entries()) {
      if (seenInThisRequest.has(o.order_id)) {
        const error = { code: ErrorCode.DUPLICATE_ORDER, message: "duplicate order_id within this batch request" };
        rejected.push({
          order_id: o.order_id,
          courier_partner: o.courier_partner,
          success: false,
          status: "FAILED",
          error,
        });
        batchItems.push({
          inputIndex,
          orderId: o.order_id,
          courierPartner: o.courier_partner,
          success: false,
          status: "FAILED",
          errorCode: error.code,
          errorMessage: error.message,
        });
        continue;
      }
      seenInThisRequest.add(o.order_id);
      accepted.push({ inputIndex, order: o });
      batchItems.push({
        inputIndex,
        orderId: o.order_id,
        courierPartner: o.courier_partner,
        success: null,
        status: "PENDING",
      });
    }

    const batch = await batchRepository.create(orders.length, rejected.length);
    await batchItemRepository.createMany(batch.id, batchItems);

    if (accepted.length) {
      void this.processBatch(batch.id, accepted, opts);
    } else {
      await batchRepository.markCompleted(batch.id);
    }

    return {
      batch_id: batch.id,
      total_orders: orders.length,
      accepted: accepted.length,
      rejected,
    };
  }

  private async processBatch(batchId: string, items: AcceptedBulkItem[], opts: { requestId?: string }) {
    const limit = pLimit(config.bulk.concurrency);
    await Promise.all(
      items.map(({ inputIndex, order }) =>
        limit(async () => {
          try {
            const result = await orderService.createOrder(order, { batchId, requestId: opts.requestId });
            await batchItemRepository.markResult(batchId, inputIndex, {
              success: true,
              status: result.status,
              awbNumber: result.awb_number,
            });
            await batchRepository.incrementResult(batchId, true);
          } catch (err) {
            const appError = err instanceof AppError ? err : undefined;
            await batchItemRepository.markResult(batchId, inputIndex, {
              success: false,
              status: "FAILED",
              errorCode: appError?.code ?? ErrorCode.INTERNAL_ERROR,
              errorMessage: (err as Error).message,
            });
            await batchRepository.incrementResult(batchId, false);
            logFailure({
              orderId: order.order_id,
              courierPartner: order.courier_partner,
              requestId: opts.requestId,
              errorType: appError?.code ?? ErrorCode.INTERNAL_ERROR,
              message: (err as Error).message,
              stack: (err as Error).stack,
              extra: { batch_id: batchId },
            });
          }
        })
      )
    );
    await batchRepository.markCompleted(batchId);
  }

  async getBatchStatus(batchId: string): Promise<BatchStatusResponse> {
    const batch = await batchRepository.findById(batchId);
    if (!batch) throw new AppError(ErrorCode.ORDER_NOT_FOUND, `No batch found for batch_id "${batchId}"`);

    const items = await batchItemRepository.listByBatch(batchId);
    const results: BulkOrderItemResult[] = items.map((item) => ({
      order_id: item.order_id,
      courier_partner: item.courier_partner,
      success: item.success === true,
      status: item.status ?? "PENDING",
      awb_number: item.awb_number,
      error:
        item.success === false
          ? { code: item.error_code ?? ErrorCode.INTERNAL_ERROR, message: item.error_message ?? "unknown error" }
          : undefined,
    }));

    return {
      batch_id: batch.id,
      status: batch.status,
      total_orders: batch.total_orders,
      succeeded: batch.succeeded,
      failed: batch.failed,
      results,
    };
  }
}

export const bulkService = new BulkService();
