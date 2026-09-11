
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import { AddressInfo } from "net";

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost:5432/courier_platform_test";

let server: http.Server;
let baseUrl: string;
let UrbaneBoltAdapter: any;

beforeAll(async () => {
  ({ UrbaneBoltAdapter } = await import("../src/couriers/urbanebolt/urbanebolt.adapter"));
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/auth/getToken/") {
        const { username } = JSON.parse(body || "{}");
        res.end(
          username === "good"
            ? JSON.stringify({ refresh: "r", access: "jwt-token" }) // DRF simplejwt-style
            : JSON.stringify({ status: "Failed", message: "Incorrect username/password!" })
        );
        return;
      }
      if (req.url === "/services/manifest/") {
        const item = JSON.parse(body)[0];
        const ok = item.customerCode === "GOOD";
        res.end(
          JSON.stringify({
            status: "Success",
            successResponse: ok ? [{ orderNumber: item.orderNumber, awb: "UB123456", status: "Booked" }] : [],
            errorResponse: ok ? [] : [{ orderNumber: item.orderNumber, customerCode: item.customerCode, status: "Failed", message: "Invalid Customer Provided!" }],
          })
        );
        return;
      }
      if (req.url?.startsWith("/services/tracking-pub/")) {
        const awb = new URL(req.url, "http://x").searchParams.get("awb");
        const byAwb: Record<string, [string, string]> = {
          "1": ["MAN", "Shipment Manifested"],
          "2": ["CAN", "Cancelled"],
          "3": ["OFD", "Out For Delivery"],
          "4": ["QQQ", "Something New"], // a code we've never seen
        };
        const hit = byAwb[awb || ""];
        if (!hit) {
          res.end(JSON.stringify({ status: "Failed", message: "Invalid Tracking Details Provided", data: [] }));
          return;
        }
        res.end(JSON.stringify({ status: "Success", message: "Tracking", data: { awbNumber: Number(awb), currentStatusCode: hit[0], currentStatusCodeDescription: hit[1], scans: [] } }));
        return;
      }
      if (req.url === "/services/cancel/") {
        const { awbs } = JSON.parse(body);
        const outcome: Record<string, object> = {
          "1": { successResponse: [{ orderNumber: "UB-1", awb: "1", message: "Cancelled" }], failureResponse: [] },
          "2": { successResponse: [], failureResponse: [{ orderNumber: "UB-1", awb: "2", message: "Shipment already cancelled!" }] },
          "9": { successResponse: [], failureResponse: [{ orderNumber: "UB-1", awb: "9", message: "Invalid AWB" }] },
        };
        res.end(JSON.stringify({ status: "Success", message: "Cancellation Proccess", ...outcome[awbs] }));
        return;
      }
      if (req.url === "/custom/create") {
        const sent = JSON.parse(body);
        res.end(JSON.stringify({ result: { waybill: `WB-${sent.ref}`, state: "booked" } }));
        return;
      }
      res.statusCode = 404;
      res.end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

function adapterFor(username: string, endpoints: Record<string, unknown> = {}, customerCode = "C1") {
  return new UrbaneBoltAdapter({
    endpoints,
    status_map: {},
    base_url: baseUrl,
    username,
    password: "pw",
    customer_code: customerCode,
    default_service_type: "SDD",
    default_return_email: "ops@example.com",
    timeout_ms: 2000,
    retry_max_attempts: 1,
    retry_base_delay_ms: 1,
  });
}

const order = {
  order_id: "UB-1",
  courier_partner: "urbanebolt",
  pickup_address: { name: "a", phone: "9876543210", line1: "a", city: "a", state: "a", pincode: "411001" },
  delivery_address: { name: "b", phone: "9876543210", line1: "b", city: "b", state: "b", pincode: "400001" },
  package: { weightKg: 1, declaredValue: 100 },
} as any;

describe("UrbaneBoltAdapter response handling", () => {
  it("turns a 200 {status: Failed} login into a COURIER_AUTH_FAILED with the courier's message", async () => {
    await expect(adapterFor("bad").authenticate()).rejects.toMatchObject({
      code: "COURIER_AUTH_FAILED",
      message: "UrbaneBolt: Incorrect username/password!",
    });
  });

  it("accepts a simplejwt-style {access} token", async () => {
    await expect(adapterFor("good").authenticate()).resolves.toBeUndefined();
  });

  it("uses an admin-overridden create endpoint, body template and response mapping", async () => {
    const adapter = adapterFor("good", {
      create: {
        path: "/custom/create",
        method: "POST",
        body_template: { ref: "{{order_id}}" },
        response: { awb_path: "result.waybill", status_path: "result.state" },
        status_map: { booked: "PICKED_UP" }, // the endpoint's own map beats the built-in one
      },
    });
    const result = await adapter.createOrder(order);
    expect(result.awbNumber).toBe("WB-UB-1");
    expect(result.rawRequest).toEqual({ ref: "UB-1" });
    expect(result.status).toBe("PICKED_UP");
  });

  it("surfaces a rejected manifest item (errorResponse[]) as a COURIER_CLIENT_ERROR with the courier's message", async () => {
    await expect(adapterFor("good", {}, "BAD").createOrder(order)).rejects.toMatchObject({
      code: "COURIER_CLIENT_ERROR",
      message: "UrbaneBolt: Invalid Customer Provided!",
      details: { status: 200 },
    });
  });

  it("reads the shipment status from data.currentStatusCode, not the API-level status", async () => {
    const adapter = adapterFor("good");
    expect((await adapter.trackShipment("UB-1", "1")).status).toBe("CREATED"); // MAN
    expect((await adapter.trackShipment("UB-1", "2")).status).toBe("CANCELLED"); // CAN
    expect((await adapter.trackShipment("UB-1", "3")).status).toBe("IN_TRANSIT"); // OFD
    expect((await adapter.trackShipment("UB-1", "4")).status).toBe("IN_TRANSIT"); // unknown -> safe default, never FAILED
    await expect(adapter.trackShipment("UB-1", "404")).rejects.toMatchObject({ code: "COURIER_CLIENT_ERROR", message: "UrbaneBolt: Invalid Tracking Details Provided" });
  });

  it("reads cancel outcomes from successResponse[] / failureResponse[]", async () => {
    const adapter = adapterFor("good");
    expect((await adapter.cancelOrder("UB-1", "1")).cancelled).toBe(true);
    expect((await adapter.cancelOrder("UB-1", "2")).cancelled).toBe(true); // already cancelled == idempotent success
    await expect(adapter.cancelOrder("UB-1", "9")).rejects.toMatchObject({ code: "COURIER_CLIENT_ERROR", message: "UrbaneBolt: Invalid AWB" });
  });

  it("reads the AWB from successResponse[] on an accepted manifest", async () => {
    const result = await adapterFor("good", {}, "GOOD").createOrder(order);
    expect(result.awbNumber).toBe("UB123456");
    expect(result.courierOrderId).toBe("UB-1");
    expect(result.status).toBe("CREATED"); // "Booked" via the built-in status map
  });
});
