
import { CreateOrderRequest, ShipmentStatus } from "../types/unified";

export interface CourierCreateOrderResult {
  courierOrderId: string;
  awbNumber: string;
  status: ShipmentStatus;
  rawRequest: unknown;
  rawResponse: unknown;
}

export interface CourierTrackResult {
  status: ShipmentStatus;
  rawResponse: unknown;
}

export interface CourierCancelResult {
  status: ShipmentStatus;
  cancelled: boolean;
  rawResponse: unknown;
}

export interface ICourierAdapter {
  readonly partnerId: string; // e.g. "urbanebolt" -- what callers pass as courier_partner
  readonly displayName: string; // e.g. "UrbaneBolt", for logs/errors

  authenticate(): Promise<void>;

  createOrder(order: CreateOrderRequest): Promise<CourierCreateOrderResult>;
  trackShipment(courierOrderId: string, awbNumber: string | null): Promise<CourierTrackResult>;
  cancelOrder(courierOrderId: string, awbNumber: string | null): Promise<CourierCancelResult>;
}
