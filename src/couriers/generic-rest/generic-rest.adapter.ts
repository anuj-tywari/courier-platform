
import { AxiosRequestConfig } from "axios";
import { ICourierAdapter, CourierCreateOrderResult, CourierTrackResult, CourierCancelResult } from "../courier-adapter.interface";
import { CreateOrderRequest, ShipmentStatus } from "../../types/unified";
import { CourierHttpClient } from "../base/http-client";
import { withAuthRetry } from "../base/auth-retry";
import { AppError, ErrorCode, CourierClientError, CourierAuthError } from "../../types/errors";
import { GenericRestConfig, EndpointConfig, Operation } from "./config.schema";
import { getPath, renderTemplate } from "./template";

function mapStatus(rawStatus: unknown, ...maps: Array<Record<string, string> | undefined>): ShipmentStatus {
  if (typeof rawStatus !== "string") return "FAILED";
  const map = maps.find((m) => m && Object.keys(m).length) || {};
  return (map[rawStatus.toLowerCase()] as ShipmentStatus) || "FAILED";
}

export class GenericRestCourierAdapter implements ICourierAdapter {
  readonly partnerId: string;
  readonly displayName: string;

  private http: CourierHttpClient;
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(partnerId: string, displayName: string, private cfg: GenericRestConfig) {
    this.partnerId = partnerId;
    this.displayName = displayName;
    this.http = new CourierHttpClient({
      baseURL: cfg.base_url,
      timeoutMs: cfg.timeout_ms,
      retryMaxAttempts: cfg.retry.max_attempts,
      retryBaseDelayMs: cfg.retry.base_delay_ms,
      partnerId,
      displayName,
    });
  }

  async authenticate(): Promise<void> {
    const auth = this.cfg.auth;
    if (auth.type !== "login_bearer") return; // other auth styles need no call
    if (this.token && Date.now() < this.tokenExpiresAt) return;

    const body = renderTemplate(auth.body_template, { username: auth.username, password: auth.password });
    const { data } = await this.http.request<unknown>({ method: auth.login_method, url: auth.login_path, data: body });
    const token = getPath(data, auth.token_path);
    if (!token) {
      throw new CourierAuthError(this.displayName, `login response did not contain a token at "${auth.token_path}"`, { status: 200, body: data });
    }
    this.token = String(token);
    this.tokenExpiresAt = Date.now() + auth.token_ttl_ms;
  }

  private withAuthRetry<T>(fn: () => Promise<T>): Promise<T> {
    return withAuthRetry({
      authenticate: () => this.authenticate(),
      invalidateToken: () => {
        this.token = null;
      },
      canReauth: this.cfg.auth.type === "login_bearer",
      fn,
    });
  }

  private requestConfig(): Partial<AxiosRequestConfig> {
    const auth = this.cfg.auth;
    switch (auth.type) {
      case "api_key_header":
        return { headers: { [auth.header_name]: auth.api_key } };
      case "basic":
        return { auth: { username: auth.username, password: auth.password } };
      case "bearer_static":
        return { headers: { Authorization: `Bearer ${auth.token}` } };
      case "login_bearer":
        return { headers: { [auth.header_name]: `${auth.header_prefix}${this.token}` } };
      case "none":
      default:
        return {};
    }
  }

  private endpoint(operation: Operation): EndpointConfig {
    const ep = this.cfg.endpoints[operation];
    if (!ep) {
      throw new AppError(
        ErrorCode.COURIER_MISCONFIGURED,
        `${this.displayName} has no "${operation}" endpoint configured`,
        { courier_partner: this.partnerId, missing_endpoint: operation }
      );
    }
    return ep;
  }

  private extract(data: unknown, response: { courier_order_id_path?: string; awb_path?: string; status_path?: string }, fallbackOrderId: string) {
    const courierOrderId = response.courier_order_id_path ? getPath(data, response.courier_order_id_path) : undefined;
    const awb = response.awb_path ? getPath(data, response.awb_path) : undefined;
    const status = response.status_path ? getPath(data, response.status_path) : undefined;
    return {
      courierOrderId: courierOrderId != null ? String(courierOrderId) : fallbackOrderId,
      awb: awb != null ? String(awb) : null,
      status,
    };
  }

  async createOrder(order: CreateOrderRequest): Promise<CourierCreateOrderResult> {
    const ep = this.endpoint("create");
    const ctx = { ...order } as unknown as Record<string, unknown>;
    const body = ep.body_template ? renderTemplate(ep.body_template, ctx) : undefined;
    const url = renderTemplate(ep.path, ctx) as string;

    const { data } = await this.withAuthRetry(() =>
      this.http.request<unknown>({ method: ep.method, url, data: body, ...this.requestConfig() })
    );

    const { courierOrderId, awb, status } = this.extract(data, ep.response, order.order_id);
    if (!awb) {
      throw new CourierClientError(this.displayName, "create-order response did not contain an AWB at the configured path", { status: 200, body: data });
    }
    return {
      courierOrderId,
      awbNumber: awb,
      status: mapStatus(status, ep.status_map, this.cfg.status_map) === "FAILED" ? "CREATED" : mapStatus(status, ep.status_map, this.cfg.status_map),
      rawRequest: body,
      rawResponse: data,
    };
  }

  async trackShipment(courierOrderId: string, awbNumber: string | null): Promise<CourierTrackResult> {
    const ep = this.endpoint("track");
    const ctx = { courier_order_id: courierOrderId, awb_number: awbNumber };
    const url = renderTemplate(ep.path, ctx) as string;
    const body = ep.body_template ? renderTemplate(ep.body_template, ctx) : undefined;

    const { data } = await this.withAuthRetry(() =>
      this.http.request<unknown>({ method: ep.method, url, data: body, ...this.requestConfig() })
    );
    const { status } = this.extract(data, ep.response, courierOrderId);
    return { status: mapStatus(status, ep.status_map, this.cfg.status_map), rawResponse: data };
  }

  async cancelOrder(courierOrderId: string, awbNumber: string | null): Promise<CourierCancelResult> {
    const ep = this.endpoint("cancel");
    const ctx = { courier_order_id: courierOrderId, awb_number: awbNumber };
    const url = renderTemplate(ep.path, ctx) as string;
    const body = ep.body_template ? renderTemplate(ep.body_template, ctx) : undefined;

    const { data } = await this.withAuthRetry(() =>
      this.http.request<unknown>({ method: ep.method, url, data: body, ...this.requestConfig() })
    );
    return { status: "CANCELLED", cancelled: true, rawResponse: data };
  }
}
