
import { randomUUID } from "crypto";
import { ICourierAdapter, CourierCreateOrderResult, CourierTrackResult, CourierCancelResult } from "../courier-adapter.interface";
import { CreateOrderRequest } from "../../types/unified";
import { CourierUnavailableError } from "../../types/errors";
import { withRetry } from "../../utils/retry";
import type { MockCourierConfig } from "./mock.definition";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, Math.min(ms, 50))); // keep demo/tests fast
}

export class MockCourierAdapter implements ICourierAdapter {
  readonly partnerId = "mockcourier";
  readonly displayName = "MockCourier";

  private orders = new Map<string, { status: string }>();

  constructor(private cfg: MockCourierConfig) {}

  async authenticate(): Promise<void> {
    await sleep(10); // simulate a token call
  }

  private async simulateCall<T>(fn: () => T): Promise<T> {
    return withRetry(
      async () => {
        await sleep(20);
        if (Math.random() < this.cfg.failure_rate) {
          throw new CourierUnavailableError(this.displayName, "simulated transient failure");
        }
        return fn();
      },
      {
        maxAttempts: this.cfg.retry_max_attempts,
        baseDelayMs: this.cfg.retry_base_delay_ms,
        isRetryable: (err) => err instanceof CourierUnavailableError,
      }
    );
  }

  async createOrder(order: CreateOrderRequest): Promise<CourierCreateOrderResult> {
    await this.authenticate();
    return this.simulateCall(() => {
      const courierOrderId = `MOCK-${randomUUID().slice(0, 8)}`;
      const awbNumber = `AWB${Math.floor(Math.random() * 1e10)}`;
      this.orders.set(courierOrderId, { status: "CREATED" });
      const rawResponse = { order_id: courierOrderId, awb: awbNumber, status: "created" };
      return {
        courierOrderId,
        awbNumber,
        status: "CREATED" as const,
        rawRequest: { ...order },
        rawResponse,
      };
    });
  }

  async trackShipment(courierOrderId: string): Promise<CourierTrackResult> {
    await this.authenticate();
    return this.simulateCall(() => {
      const existing = this.orders.get(courierOrderId)?.status || "IN_TRANSIT";
      return { status: existing as any, rawResponse: { order_id: courierOrderId, status: existing } };
    });
  }

  async cancelOrder(courierOrderId: string): Promise<CourierCancelResult> {
    await this.authenticate();
    return this.simulateCall(() => {
      this.orders.set(courierOrderId, { status: "CANCELLED" });
      return { status: "CANCELLED" as const, cancelled: true, rawResponse: { order_id: courierOrderId, status: "cancelled" } };
    });
  }
}
