
export interface Address {
  name: string;
  phone: string;
  email?: string; // some couriers (e.g. UrbaneBolt) require it; falls back to a configured default if omitted
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
  country?: string; // defaults to "IN"
}

export interface PackageDetails {
  weightKg: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  declaredValue: number;
  description?: string;
}

export interface CreateOrderRequest {
  order_id: string; // caller-supplied, globally unique, used for idempotency
  courier_partner: string;
  pickup_address: Address;
  delivery_address: Address;
  package: PackageDetails;
  payment_mode?: "PREPAID" | "COD";
  cod_amount?: number;
  reference_note?: string;
}

export type ShipmentStatus =
  | "PENDING"
  | "CREATED"
  | "PICKED_UP"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "CANCELLED"
  | "FAILED";

export interface OrderResult {
  order_id: string;
  courier_partner: string;
  courier_order_id: string | null;
  awb_number: string | null;
  status: ShipmentStatus;
  failure_reason?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TrackingEventDto {
  status: ShipmentStatus;
  source: string;
  occurred_at: string;
}

export interface TrackResult extends OrderResult {
  history: TrackingEventDto[];
}

export interface CancelResult {
  order_id: string;
  status: ShipmentStatus;
  cancelled: boolean;
}

export interface BulkOrderItemResult {
  order_id: string;
  courier_partner: string;
  success: boolean;
  status?: ShipmentStatus;
  awb_number?: string | null;
  error?: { code: string; message: string };
}

export interface BulkSubmitResponse {
  batch_id: string;
  total_orders: number;
  accepted: number; // orders that passed validation and were queued
  rejected: BulkOrderItemResult[]; // orders that failed validation up front
}

export interface BatchStatusResponse {
  batch_id: string;
  status: "PROCESSING" | "COMPLETED";
  total_orders: number;
  succeeded: number;
  failed: number;
  results: BulkOrderItemResult[];
}
