import { ICourierAdapter, CourierCreateOrderResult, CourierTrackResult, CourierCancelResult } from "../courier-adapter.interface";
import { CreateOrderRequest, ShipmentStatus } from "../../types/unified";
import { CourierHttpClient } from "../base/http-client";
import { withAuthRetry } from "../base/auth-retry";
import { CourierAuthError, CourierClientError } from "../../types/errors";
import { logger } from "../../utils/logger";
import { getPath, renderTemplate } from "../generic-rest/template";
import { URBANEBOLT_DEFAULT_ENDPOINTS, type UrbaneBoltConfig } from "./urbanebolt.definition";
import { UrbaneBoltManifestItem, URBANEBOLT_STATUS_MAP } from "./urbanebolt.types";

type EndpointName = keyof typeof URBANEBOLT_DEFAULT_ENDPOINTS;

function extractToken(data: any): string | null {
  const candidates = [data, data?.data, data?.result];
  for (const obj of candidates) {
    if (!obj || typeof obj !== "object") continue;
    for (const key of ["token", "access_token", "accessToken", "access", "jwt"]) {
      if (typeof obj[key] === "string" && obj[key]) return obj[key];
    }
  }
  return null;
}

function manifestRecord(data: any, orderNumber: string): any {
  const byOrder = (list: unknown) =>
    Array.isArray(list) ? list.find((r: any) => r?.orderNumber === orderNumber) || list[0] : undefined;
  return byOrder(data?.successResponse) ?? byOrder(data) ?? byOrder(data?.data) ?? data;
}

function extractManifestResult(data: any, orderNumber: string): { awb: string | null; courierOrderId: string | null; status: string | undefined } {
  const record = manifestRecord(data, orderNumber);
  const awb = record?.awb || record?.awbs || record?.AWB || record?.awb_number || record?.awbNumber || null;
  const courierOrderId = record?.orderId || record?.order_id || record?.orderNumber || orderNumber;
  const status = record?.status || record?.shipmentStatus;
  return { awb, courierOrderId, status };
}

function failureMessage(data: any, orderNumber?: string): string | null {
  if (!data || typeof data !== "object") return null;
  if (typeof data.status === "string" && /^fail/i.test(data.status)) {
    return typeof data.message === "string" && data.message ? data.message : "request failed";
  }
  if (Array.isArray(data.errorResponse) && data.errorResponse.length) {
    const mine = orderNumber ? data.errorResponse.find((r: any) => r?.orderNumber === orderNumber) : undefined;
    const entry = mine ?? data.errorResponse[0];
    return typeof entry?.message === "string" && entry.message ? entry.message : "manifest rejected";
  }
  return null;
}

function payModeFor(order: CreateOrderRequest): "COD" | "PPD" {
  return order.payment_mode === "COD" ? "COD" : "PPD";
}

function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

export class UrbaneBoltAdapter implements ICourierAdapter {
  readonly partnerId = "urbanebolt";
  readonly displayName = "UrbaneBolt";

  private http: CourierHttpClient;
  private token: string | null = null;
  private tokenExpiresAt = 0;
  private static readonly TOKEN_TTL_MS = 20 * 60 * 1000;

  constructor(private cfg: UrbaneBoltConfig) {
    this.http = new CourierHttpClient({
      baseURL: cfg.base_url,
      timeoutMs: cfg.timeout_ms,
      retryMaxAttempts: cfg.retry_max_attempts,
      retryBaseDelayMs: cfg.retry_base_delay_ms,
      partnerId: this.partnerId,
      displayName: this.displayName,
    });
  }

  private endpoint(name: EndpointName) {
    return this.cfg.endpoints?.[name] ?? URBANEBOLT_DEFAULT_ENDPOINTS[name]!;
  }

  private lookupStatus(courierStatus: unknown, endpointMap?: Record<string, string>): ShipmentStatus | undefined {
    if (typeof courierStatus !== "string" || !courierStatus) return undefined;
    const map = [endpointMap, this.cfg.status_map].find((m) => m && Object.keys(m).length) || URBANEBOLT_STATUS_MAP;
    return map[courierStatus.toLowerCase()] as ShipmentStatus | undefined;
  }

  private mapStatus(courierStatus: unknown, endpointMap?: Record<string, string>): ShipmentStatus {
    return this.lookupStatus(courierStatus, endpointMap) ?? "FAILED";
  }

  private fail(data: unknown, orderNumber?: string): void {
    const failed = failureMessage(data, orderNumber);
    if (failed) throw new CourierClientError(this.displayName, failed, { status: 200, body: data });
  }

  async authenticate(): Promise<void> {
    if (this.token && Date.now() < this.tokenExpiresAt) return;
    if (!this.cfg.username || !this.cfg.password) {
      throw new CourierAuthError(this.displayName, "username/password not set -- configure them in the admin UI");
    }
    const ep = this.endpoint("auth");
    const ctx = { username: this.cfg.username, password: this.cfg.password };
    const { data } = await this.http.request<unknown>({
      method: ep.method,
      url: renderTemplate(ep.path, ctx) as string,
      data: renderTemplate(ep.body_template ?? URBANEBOLT_DEFAULT_ENDPOINTS.auth!.body_template, ctx),
    });
    const failed = failureMessage(data);
    if (failed) throw new CourierAuthError(this.displayName, failed, { status: 200, body: data });

    const token = ep.response?.token_path ? getPath(data, ep.response.token_path) : extractToken(data);
    if (!token) {
      const keys = data && typeof data === "object" ? Object.keys(data as object).join(", ") : typeof data;
      throw new CourierAuthError(this.displayName, `getToken response did not contain a recognizable token field (got: ${keys})`, { status: 200, body: data });
    }
    this.token = String(token);
    const expiresIn = Number((data as any)?.expires_in);
    const ttlMs = Number.isFinite(expiresIn) && expiresIn > 120 ? (expiresIn - 60) * 1000 : UrbaneBoltAdapter.TOKEN_TTL_MS;
    this.tokenExpiresAt = Date.now() + ttlMs;
  }

  private withAuthRetry<T>(fn: () => Promise<T>): Promise<T> {
    return withAuthRetry({
      authenticate: () => this.authenticate(),
      invalidateToken: () => {
        this.token = null;
      },
      canReauth: true,
      fn,
    });
  }

  private authHeaders() {
    return { Authorization: `Bearer ${this.token}` };
  }

  private toManifestItem(order: CreateOrderRequest): UrbaneBoltManifestItem {
    const pickup = order.pickup_address;
    const delivery = order.delivery_address;
    return {
      customerCode: this.cfg.customer_code,
      orderNumber: order.order_id,
      declaredValue: order.package.declaredValue,
      itemDescription: order.package.description || "General Merchandise",
      collectableValue: order.payment_mode === "COD" ? order.cod_amount || order.package.declaredValue : 0,
      height: order.package.heightCm ?? 10,
      length: order.package.lengthCm ?? 10,
      breadth: order.package.widthCm ?? 10,
      weight: order.package.weightKg,
      pieces: 1,
      serviceType: this.cfg.default_service_type,
      payMode: payModeFor(order),
      invoiceNumber: order.order_id,
      invoiceDate: todayISODate(),
      invoiceValue: order.package.declaredValue,
      itemQuantity: 1,

      shprName: pickup.name,
      shprAddress: [pickup.line1, pickup.line2].filter(Boolean).join(", "),
      shprAddressType: "Seller",
      shprCity: pickup.city,
      shprState: pickup.state,
      shprCountry: pickup.country || "INDIA",
      shprPincode: Number(pickup.pincode),
      shprMobile: Number(pickup.phone),
      shprEmail: pickup.email || this.cfg.default_return_email,

      consName: delivery.name,
      consAddress: [delivery.line1, delivery.line2].filter(Boolean).join(", "),
      consAddressType: "Home",
      consCity: delivery.city,
      consState: delivery.state,
      consCountry: delivery.country || "INDIA",
      consPincode: Number(delivery.pincode),
      consMobile: Number(delivery.phone),
      consEmail: delivery.email || this.cfg.default_return_email,

      rtnName: pickup.name,
      rtnAddress: [pickup.line1, pickup.line2].filter(Boolean).join(", "),
      rtnAddressType: "Seller",
      rtnCity: pickup.city,
      rtnState: pickup.state,
      rtnCountry: pickup.country || "INDIA",
      rtnPincode: Number(pickup.pincode),
      rtnMobile: Number(pickup.phone),
      rtnEmail: pickup.email || this.cfg.default_return_email,
    };
  }

  async createOrder(order: CreateOrderRequest): Promise<CourierCreateOrderResult> {
    const ep = this.endpoint("create");
    const ctx = { ...order, customer_code: this.cfg.customer_code, today: todayISODate() } as unknown as Record<string, unknown>;
    const payload: unknown = ep.body_template ? renderTemplate(ep.body_template, ctx) : [this.toManifestItem(order)];

    const { data } = await this.withAuthRetry(() =>
      this.http.request<unknown>({ method: ep.method, url: renderTemplate(ep.path, ctx) as string, data: payload, headers: this.authHeaders() })
    );
    this.fail(data, order.order_id);

    const resp = ep.response || {};
    const builtIn = extractManifestResult(data, order.order_id);
    const awb = resp.awb_path ? getPath(data, resp.awb_path) : builtIn.awb;
    const courierOrderId = resp.courier_order_id_path ? getPath(data, resp.courier_order_id_path) : builtIn.courierOrderId;
    const status = resp.status_path ? getPath(data, resp.status_path) : builtIn.status;
    if (!awb) {
      throw new CourierClientError(this.displayName, "manifest response did not contain a recognizable AWB field", { status: 200, body: data });
    }

    const mapped = this.mapStatus(status, ep.status_map);
    return {
      courierOrderId: courierOrderId != null ? String(courierOrderId) : order.order_id,
      awbNumber: String(awb),
      status: mapped === "FAILED" ? "CREATED" : mapped,
      rawRequest: payload,
      rawResponse: data,
    };
  }

  async trackShipment(courierOrderId: string, awbNumber: string | null): Promise<CourierTrackResult> {
    const ep = this.endpoint("track");
    const ctx = { courier_order_id: courierOrderId, awb_number: awbNumber };
    const { data } = await this.withAuthRetry(() =>
      this.http.request<unknown>({
        method: ep.method,
        url: renderTemplate(ep.path, ctx) as string,
        data: ep.body_template ? renderTemplate(ep.body_template, ctx) : undefined,
        headers: this.authHeaders(),
      })
    );
    this.fail(data);

    const d = data as any;
    const code = ep.response?.status_path ? getPath(data, ep.response.status_path) : d?.data?.currentStatusCode;
    const mapped = this.lookupStatus(code, ep.status_map);
    if (!mapped) {
      logger.warn(
        { courier_partner: this.partnerId, awb: awbNumber, code, description: d?.data?.currentStatusCodeDescription },
        "unmapped UrbaneBolt tracking status"
      );
    }
    return { status: mapped ?? "IN_TRANSIT", rawResponse: data };
  }

  async cancelOrder(courierOrderId: string, awbNumber: string | null): Promise<CourierCancelResult> {
    const ep = this.endpoint("cancel");
    const ctx = { courier_order_id: courierOrderId, awb_number: awbNumber || "" };
    const { data } = await this.withAuthRetry(() =>
      this.http.request<unknown>({
        method: ep.method,
        url: renderTemplate(ep.path, ctx) as string,
        data: ep.body_template ? renderTemplate(ep.body_template, ctx) : undefined,
        headers: this.authHeaders(),
      })
    );
    this.fail(data);

    const d = data as any;
    const mine = (list: unknown) =>
      Array.isArray(list) ? list.find((r: any) => String(r?.awb ?? r?.awbNumber ?? "") === String(awbNumber ?? "")) ?? list[0] : undefined;
    const failure = mine(d?.failureResponse);
    if (failure && !mine(d?.successResponse)) {
      const message = typeof failure.message === "string" ? failure.message : "cancellation rejected";
      if (!/already cancel/i.test(message)) {
        throw new CourierClientError(this.displayName, message, { status: 200, body: data });
      }
    }
    return { status: "CANCELLED", cancelled: true, rawResponse: data };
  }
}
