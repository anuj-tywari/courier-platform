
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { bootApp } from "./helpers/test-db";
import { startFixtureCourierServer, FIXTURE_API_KEY } from "./helpers/fixture-courier-server";

let request: any;
let app: any;
let fixture: Awaited<ReturnType<typeof startFixtureCourierServer>>;

const ADMIN_AUTH = { Authorization: "Bearer test-admin-token" };

beforeAll(async () => {
  request = (await import("supertest")).default;
  app = await bootApp();
  fixture = await startFixtureCourierServer();
});

afterAll(async () => {
  await fixture.close();
});

function sampleOrder(orderId: string) {
  return {
    order_id: orderId,
    courier_partner: "fixturecourier",
    pickup_address: { name: "Warehouse", phone: "9876543210", line1: "Plot 1", city: "Pune", state: "MH", pincode: "411001" },
    delivery_address: { name: "Customer", phone: "9123456780", line1: "Some Street", city: "Mumbai", state: "MH", pincode: "400001" },
    package: { weightKg: 1, declaredValue: 500 },
  };
}

describe("Generic REST courier, configured entirely via the admin API", () => {
  it("registers a brand-new courier with a JSON config and no code changes", async () => {
    const res = await request(app)
      .post("/api/v1/admin/couriers")
      .set(ADMIN_AUTH)
      .send({
        id: "fixturecourier",
        display_name: "Fixture Courier",
        config: {
          base_url: fixture.url,
          auth: { type: "api_key_header", header_name: "X-Api-Key", api_key: FIXTURE_API_KEY },
          endpoints: {
            create: {
              path: "/shipments",
              method: "POST",
              body_template: { ref: "{{order_id}}", weight: "{{package.weightKg}}" },
              response: { courier_order_id_path: "id", awb_path: "tracking", status_path: "state" },
            },
            track: { path: "/shipments/{{courier_order_id}}", method: "GET", response: { status_path: "state" } },
            cancel: { path: "/shipments/{{courier_order_id}}/void", method: "POST", response: { status_path: "state" } },
          },
          status_map: { new: "CREATED", in_transit: "IN_TRANSIT", voided: "CANCELLED" },
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe("fixturecourier");
    expect(res.body.data.enabled).toBe(true);
  });

  it("shows up in the consumer-facing GET /couriers list immediately", async () => {
    const res = await request(app).get("/api/v1/couriers");
    expect(res.body.data.supported_couriers).toContain("fixturecourier");
  });

  it("creates, tracks, and cancels a real order through the unified API", async () => {
    const create = await request(app).post("/api/v1/orders").send(sampleOrder("ORD-FX-1"));
    expect(create.status).toBe(201);
    expect(create.body.data.status).toBe("CREATED"); // create response reports state: "new" -> CREATED
    expect(create.body.data.awb_number).toMatch(/^TRKFX-/);

    const track = await request(app).get("/api/v1/orders/ORD-FX-1/track");
    expect(track.status).toBe(200);
    expect(track.body.data.status).toBe("IN_TRANSIT");

    const cancel = await request(app).post("/api/v1/orders/ORD-FX-1/cancel");
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.status).toBe("CANCELLED");
  });

  it("rejects the wrong API key with a normalized (not leaked-raw) error", async () => {
    await request(app)
      .put("/api/v1/admin/couriers/fixturecourier")
      .set(ADMIN_AUTH)
      .send({
        display_name: "Fixture Courier",
        config: {
          base_url: fixture.url,
          auth: { type: "api_key_header", header_name: "X-Api-Key", api_key: "wrong-key" },
          endpoints: {
            create: { path: "/shipments", method: "POST", body_template: { ref: "{{order_id}}" }, response: { courier_order_id_path: "id", awb_path: "tracking", status_path: "state" } },
            track: { path: "/shipments/{{courier_order_id}}", method: "GET", response: { status_path: "state" } },
            cancel: { path: "/shipments/{{courier_order_id}}/void", method: "POST", response: {} },
          },
          status_map: {},
        },
      });

    const res = await request(app).post("/api/v1/orders").send(sampleOrder("ORD-FX-2"));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("COURIER_CLIENT_ERROR");
    expect(res.body.error.details).toEqual({ status: 401 });
  });

  it("disabling then bulk re-enabling the courier round-trips correctly", async () => {
    await request(app).patch("/api/v1/admin/couriers/fixturecourier/enable").set(ADMIN_AUTH).send({ enabled: false });
    const rejected = await request(app).post("/api/v1/orders").send(sampleOrder("ORD-FX-3"));
    expect(rejected.body.error.code).toBe("COURIER_DISABLED");

    const bulk = await request(app)
      .post("/api/v1/admin/couriers/bulk-enable")
      .set(ADMIN_AUTH)
      .send({ ids: ["fixturecourier", "mockcourier"], enabled: true });
    expect(bulk.status).toBe(200);
    expect(bulk.body.data.every((c: any) => c.enabled)).toBe(true);
  });

  it("deletes a generic_rest courier and a coded one alike, and a deleted coded id can't be re-created as generic", async () => {
    const generic = await request(app).delete("/api/v1/admin/couriers/fixturecourier").set(ADMIN_AUTH);
    expect(generic.status).toBe(204);

    const coded = await request(app).delete("/api/v1/admin/couriers/mockcourier").set(ADMIN_AUTH);
    expect(coded.status).toBe(204);

    const list = await request(app).get("/api/v1/couriers");
    expect(list.body.data.supported_couriers).toEqual(["urbanebolt"]);

    const impostor = await request(app)
      .post("/api/v1/admin/couriers")
      .set(ADMIN_AUTH)
      .send({ id: "mockcourier", display_name: "Impostor", config: { base_url: "http://127.0.0.1:9", auth: { type: "none" } } });
    expect(impostor.status).toBe(400);
  });
});
