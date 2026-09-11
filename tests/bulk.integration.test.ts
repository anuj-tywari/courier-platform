import { describe, it, expect, beforeAll } from "vitest";
import { bootApp } from "./helpers/test-db";

let request: any;
let app: any;

beforeAll(async () => {
  request = (await import("supertest")).default;
  app = await bootApp();
});

function sampleOrder(orderId: string, courierPartner = "mockcourier") {
  return {
    order_id: orderId,
    courier_partner: courierPartner,
    pickup_address: {
      name: "Warehouse",
      phone: "9876543210",
      line1: "Plot 1",
      city: "Pune",
      state: "MH",
      pincode: "411001",
    },
    delivery_address: {
      name: "Customer",
      phone: "9123456780",
      line1: "Some Street",
      city: "Mumbai",
      state: "MH",
      pincode: "400001",
    },
    package: { weightKg: 1, declaredValue: 500 },
  };
}

describe("POST /api/v1/orders", () => {
  it("creates an order via the unified API and normalizes the courier response", async () => {
    const res = await request(app).post("/api/v1/orders").send(sampleOrder("ORD-A1"));
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("CREATED");
    expect(res.body.data.awb_number).toBeTruthy();
  });

  it("is idempotent on order_id -- resubmitting does not create a second shipment", async () => {
    const first = await request(app).post("/api/v1/orders").send(sampleOrder("ORD-A2"));
    const second = await request(app).post("/api/v1/orders").send(sampleOrder("ORD-A2"));
    expect(first.body.data.awb_number).toBe(second.body.data.awb_number);
  });

  it("rejects malformed input with field-level 400 errors", async () => {
    const res = await request(app).post("/api/v1/orders").send({ order_id: "ORD-BAD" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details.fields.length).toBeGreaterThan(0);
  });

  it("rejects an unknown courier_partner with a list of supported couriers", async () => {
    const res = await request(app).post("/api/v1/orders").send(sampleOrder("ORD-A3", "not-a-real-courier"));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("UNKNOWN_COURIER");
    expect(res.body.error.details.supported_couriers).toContain("mockcourier");
  });

  it("rejects reusing an order_id under a different courier_partner", async () => {
    await request(app).post("/api/v1/orders").send(sampleOrder("ORD-A4", "mockcourier"));
    const res = await request(app).post("/api/v1/orders").send(sampleOrder("ORD-A4", "urbanebolt"));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DUPLICATE_ORDER");
  });

  it("rejects orders for a disabled courier with COURIER_DISABLED", async () => {
    const disableRes = await request(app)
      .patch("/api/v1/admin/couriers/mockcourier/enable")
      .set("Authorization", "Bearer test-admin-token")
      .send({ enabled: false });
    expect(disableRes.status).toBe(200);

    const res = await request(app).post("/api/v1/orders").send(sampleOrder("ORD-A5"));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("COURIER_DISABLED");

    await request(app)
      .patch("/api/v1/admin/couriers/mockcourier/enable")
      .set("Authorization", "Bearer test-admin-token")
      .send({ enabled: true });
  });
});

describe("GET /api/v1/couriers", () => {
  it("lists enabled courier partners", async () => {
    const res = await request(app).get("/api/v1/couriers");
    expect(res.status).toBe(200);
    expect(res.body.data.supported_couriers).toEqual(expect.arrayContaining(["mockcourier", "urbanebolt"]));
  });
});

describe("GET /:order_id/track and POST /:order_id/cancel", () => {
  it("tracks and then cancels an order, recording append-only history", async () => {
    await request(app).post("/api/v1/orders").send(sampleOrder("ORD-B1"));

    const track = await request(app).get("/api/v1/orders/ORD-B1/track");
    expect(track.status).toBe(200);
    expect(track.body.data.history.length).toBeGreaterThanOrEqual(1);

    const cancel = await request(app).post("/api/v1/orders/ORD-B1/cancel");
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.status).toBe("CANCELLED");

    const trackAfter = await request(app).get("/api/v1/orders/ORD-B1/track");
    expect(trackAfter.body.data.status).toBe("CANCELLED");
    expect(trackAfter.body.data.history.length).toBeGreaterThan(track.body.data.history.length);
  });

  it("returns 404 for tracking an order that was never created", async () => {
    const res = await request(app).get("/api/v1/orders/does-not-exist/track");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ORDER_NOT_FOUND");
  });

  it("tracks/cancels an order that never reached the courier without calling the adapter", async () => {
    const { orderRepository } = await import("../src/repositories/order.repository");
    await orderRepository.createIfNotExists({
      orderId: "ORD-NOAWB",
      courierPartner: "mockcourier",
      normalizedRequest: sampleOrder("ORD-NOAWB") as any,
    });
    await orderRepository.markResult({ orderId: "ORD-NOAWB", status: "FAILED", failureReason: "simulated" });

    const track = await request(app).get("/api/v1/orders/ORD-NOAWB/track");
    expect(track.status).toBe(200);
    expect(track.body.data.status).toBe("FAILED");

    const cancel = await request(app).post("/api/v1/orders/ORD-NOAWB/cancel");
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.status).toBe("CANCELLED");
    expect(cancel.body.data.cancelled).toBe(true);
  });
});

describe("POST /api/v1/orders/bulk", () => {
  async function waitForBatch(batchId: string) {
    let status: any;
    for (let i = 0; i < 50; i++) {
      status = await request(app).get(`/api/v1/orders/bulk/${batchId}`);
      if (status.body?.data?.status === "COMPLETED") break;
      await new Promise((r) => setTimeout(r, 100));
    }
    return status;
  }

  it("accepts a batch, processes concurrently in the background, and reports partial results", async () => {
    const orders = Array.from({ length: 10 }, (_, i) => sampleOrder(`ORD-BULK-${i}`));
    const submit = await request(app).post("/api/v1/orders/bulk").send({ orders });

    expect(submit.status).toBe(202);
    expect(submit.body.data.accepted).toBe(10);
    const batchId = submit.body.data.batch_id;

    const status = await waitForBatch(batchId);

    expect(status.body.data.status).toBe("COMPLETED");
    expect(status.body.data.succeeded).toBe(10);
    expect(status.body.data.results).toHaveLength(10);
  });

  it("rejects a duplicate order_id within the same batch request without queueing it twice", async () => {
    const dup = sampleOrder("ORD-DUP-1");
    const res = await request(app).post("/api/v1/orders/bulk").send({ orders: [dup, dup] });
    expect(res.body.data.accepted).toBe(1);
    expect(res.body.data.rejected).toHaveLength(1);
    expect(res.body.data.rejected[0].error.code).toBe("DUPLICATE_ORDER");
  });

  it("reports accepted items that fail before an order row exists", async () => {
    const orders = [sampleOrder("ORD-BULK-BAD", "not-a-real-courier")];
    const submit = await request(app).post("/api/v1/orders/bulk").send({ orders });
    expect(submit.status).toBe(202);

    const status = await waitForBatch(submit.body.data.batch_id);
    expect(status.body.data.status).toBe("COMPLETED");
    expect(status.body.data.failed).toBe(1);
    expect(status.body.data.results).toHaveLength(1);
    expect(status.body.data.results[0]).toMatchObject({
      order_id: "ORD-BULK-BAD",
      courier_partner: "not-a-real-courier",
      success: false,
      status: "FAILED",
      error: { code: "UNKNOWN_COURIER" },
    });
  });

  it("reports idempotent replays inside a later batch", async () => {
    const existing = await request(app).post("/api/v1/orders").send(sampleOrder("ORD-BULK-REPLAY"));
    expect(existing.status).toBe(201);

    const submit = await request(app).post("/api/v1/orders/bulk").send({ orders: [sampleOrder("ORD-BULK-REPLAY")] });
    expect(submit.status).toBe(202);

    const status = await waitForBatch(submit.body.data.batch_id);
    expect(status.body.data.status).toBe("COMPLETED");
    expect(status.body.data.succeeded).toBe(1);
    expect(status.body.data.results).toHaveLength(1);
    expect(status.body.data.results[0]).toMatchObject({
      order_id: "ORD-BULK-REPLAY",
      success: true,
      awb_number: existing.body.data.awb_number,
    });
  });

  it("rejects a batch over the 100-order limit at the schema level", async () => {
    const tooMany = Array.from({ length: 101 }, (_, i) => sampleOrder(`ORD-TOO-MANY-${i}`));
    const res = await request(app).post("/api/v1/orders/bulk").send({ orders: tooMany });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});
