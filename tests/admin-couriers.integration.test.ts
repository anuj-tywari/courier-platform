import { describe, it, expect, beforeAll } from "vitest";
import { bootApp } from "./helpers/test-db";

let request: any;
let app: any;

const ADMIN_AUTH = { Authorization: "Bearer test-admin-token" };

const validConfig = {
  base_url: "http://127.0.0.1:9/does-not-matter",
  auth: { type: "none" },
  endpoints: {
    create: { path: "/x", method: "POST", response: {} },
    track: { path: "/x", method: "GET", response: {} },
    cancel: { path: "/x", method: "POST", response: {} },
  },
  status_map: {},
};

beforeAll(async () => {
  request = (await import("supertest")).default;
  app = await bootApp();
});

describe("Admin API auth", () => {
  it("rejects requests with no admin token", async () => {
    const res = await request(app).get("/api/v1/admin/couriers");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects requests with the wrong admin token", async () => {
    const res = await request(app).get("/api/v1/admin/couriers").set("Authorization", "Bearer nope");
    expect(res.status).toBe(401);
  });

  it("accepts requests with the correct admin token", async () => {
    const res = await request(app).get("/api/v1/admin/couriers").set(ADMIN_AUTH);
    expect(res.status).toBe(200);
  });
});

describe("Admin courier CRUD", () => {
  it("seeds the coded adapters into the DB with their defaults and admin-renderable fields", async () => {
    const res = await request(app).get("/api/v1/admin/couriers").set(ADMIN_AUTH);
    const ids = res.body.data.map((c: any) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["urbanebolt", "mockcourier"]));
    const ub = res.body.data.find((c: any) => c.id === "urbanebolt");
    expect(ub.kind).toBe("code");
    expect(ub.config.base_url).toBe("https://uat.urbanebolt.in/api/v1");
    expect(ub.fields.map((f: any) => f.key)).toContain("password");

    const rename = await request(app).put("/api/v1/admin/couriers/mockcourier").set(ADMIN_AUTH).send({ display_name: "Mock (renamed)" });
    expect(rename.status).toBe(200);
    expect(rename.body.data.display_name).toBe("Mock (renamed)");
  });

  it("stores a coded adapter's credentials in the DB, masked on read, preserved behind the mask", async () => {
    const creds = {
      base_url: "https://uat.urbanebolt.in/api/v1",
      username: "acme",
      password: "s3cret",
      customer_code: "ACME01",
      default_service_type: "SDD",
      default_return_email: "ops@acme.test",
      timeout_ms: 5000,
      retry_max_attempts: 2,
      retry_base_delay_ms: 100,
    };
    const set = await request(app).put("/api/v1/admin/couriers/urbanebolt").set(ADMIN_AUTH).send({ display_name: "UrbaneBolt", config: creds });
    expect(set.status).toBe(200);
    expect(set.body.data.config.username).toBe("acme");
    expect(set.body.data.config.password).toBe("••••••••");

    const again = await request(app)
      .put("/api/v1/admin/couriers/urbanebolt")
      .set(ADMIN_AUTH)
      .send({ display_name: "UrbaneBolt", config: { ...creds, password: "••••••••", timeout_ms: 6000 } });
    expect(again.status).toBe(200);

    const { courierPartnerRepository } = await import("../src/repositories/courier-partner.repository");
    const row = await courierPartnerRepository.findById("urbanebolt");
    expect((row!.config as any).password).toBe("s3cret");
    expect((row!.config as any).timeout_ms).toBe(6000);

    const bad = await request(app).put("/api/v1/admin/couriers/urbanebolt").set(ADMIN_AUTH).send({ display_name: "UrbaneBolt", config: { ...creds, timeout_ms: "fast" } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.fields[0].field).toBe("config.timeout_ms");
  });

  it("a deleted courier is gone from the app: no list entry, no lookup, no restore route", async () => {
    await request(app).post("/api/v1/admin/couriers").set(ADMIN_AUTH).send({ id: "gonecourier", display_name: "Gone", config: validConfig });
    expect((await request(app).delete("/api/v1/admin/couriers/gonecourier").set(ADMIN_AUTH)).status).toBe(204);

    expect((await request(app).get("/api/v1/couriers")).body.data.supported_couriers).not.toContain("gonecourier");
    expect((await request(app).get("/api/v1/admin/couriers").set(ADMIN_AUTH)).body.data.map((c: any) => c.id)).not.toContain("gonecourier");
    expect((await request(app).get("/api/v1/admin/couriers/gonecourier").set(ADMIN_AUTH)).status).toBe(404);
    expect((await request(app).post("/api/v1/admin/couriers/gonecourier/restore").set(ADMIN_AUTH)).status).toBe(404);
    expect((await request(app).get("/api/v1/admin/couriers/deleted").set(ADMIN_AUTH)).status).toBe(404);
  });

  it("never lets the last active courier be deactivated or deleted", async () => {
    await request(app).post("/api/v1/admin/couriers").set(ADMIN_AUTH).send({ id: "guardvictim", display_name: "Victim", config: validConfig });
    const all = (await request(app).get("/api/v1/admin/couriers").set(ADMIN_AUTH)).body.data.map((c: any) => c.id);
    const others = all.filter((id: string) => id !== "urbanebolt");

    const bulkOff = await request(app).post("/api/v1/admin/couriers/bulk-enable").set(ADMIN_AUTH).send({ ids: others, enabled: false });
    expect(bulkOff.status).toBe(200);

    const single = await request(app).patch("/api/v1/admin/couriers/urbanebolt/enable").set(ADMIN_AUTH).send({ enabled: false });
    expect(single.status).toBe(400);
    expect(single.body.error.message).toMatch(/at least one courier/i);

    const del = await request(app).delete("/api/v1/admin/couriers/urbanebolt").set(ADMIN_AUTH);
    expect(del.status).toBe(400);

    const bulkAll = await request(app).post("/api/v1/admin/couriers/bulk-enable").set(ADMIN_AUTH).send({ ids: all, enabled: false });
    expect(bulkAll.status).toBe(400);

    expect((await request(app).get("/api/v1/couriers")).body.data.supported_couriers).toEqual(["urbanebolt"]);

    const delDisabled = await request(app).delete("/api/v1/admin/couriers/guardvictim").set(ADMIN_AUTH);
    expect(delDisabled.status).toBe(204);

    await request(app).post("/api/v1/admin/couriers/bulk-enable").set(ADMIN_AUTH).send({ ids: others.filter((id: string) => id !== "guardvictim"), enabled: true });
  });

  it("rejects an invalid partner id slug with a field-level 400", async () => {
    const res = await request(app)
      .post("/api/v1/admin/couriers")
      .set(ADMIN_AUTH)
      .send({ id: "Not_Valid!", display_name: "Bad", config: validConfig });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects creating a courier id that collides with an existing one", async () => {
    const res = await request(app)
      .post("/api/v1/admin/couriers")
      .set(ADMIN_AUTH)
      .send({ id: "mockcourier", display_name: "Dup", config: validConfig });
    expect(res.status).toBe(400);
  });

  it("creates, updates, and deletes a generic_rest courier", async () => {
    const create = await request(app)
      .post("/api/v1/admin/couriers")
      .set(ADMIN_AUTH)
      .send({ id: "acmecourier", display_name: "Acme", config: validConfig });
    expect(create.status).toBe(201);

    const update = await request(app)
      .put("/api/v1/admin/couriers/acmecourier")
      .set(ADMIN_AUTH)
      .send({ display_name: "Acme Logistics", config: validConfig });
    expect(update.status).toBe(200);
    expect(update.body.data.display_name).toBe("Acme Logistics");

    const del = await request(app).delete("/api/v1/admin/couriers/acmecourier").set(ADMIN_AUTH);
    expect(del.status).toBe(204);

    const get = await request(app).get("/api/v1/admin/couriers/acmecourier").set(ADMIN_AUTH);
    expect(get.status).toBe(404);

    const list = await request(app).get("/api/v1/admin/couriers").set(ADMIN_AUTH);
    expect(list.body.data.map((c: any) => c.id)).not.toContain("acmecourier");
  });

  it("deleting is a soft delete: re-adding the same id revives it instead of failing", async () => {
    await request(app).post("/api/v1/admin/couriers").set(ADMIN_AUTH).send({ id: "revivecourier", display_name: "V1", config: validConfig });
    await request(app).delete("/api/v1/admin/couriers/revivecourier").set(ADMIN_AUTH);

    const recreate = await request(app)
      .post("/api/v1/admin/couriers")
      .set(ADMIN_AUTH)
      .send({ id: "revivecourier", display_name: "V2", config: validConfig });
    expect(recreate.status).toBe(201);
    expect(recreate.body.data.display_name).toBe("V2");
    expect(recreate.body.data.enabled).toBe(true);
  });

  it("lets UrbaneBolt's endpoints be edited and reset, but not MockCourier's (in-process)", async () => {
    const before = await request(app).get("/api/v1/admin/couriers/urbanebolt").set(ADMIN_AUTH);
    expect(before.body.data.endpoint_operations).toEqual(["auth", "create", "track", "cancel"]);
    expect(before.body.data.config.endpoints.track.path).toBe("/services/tracking-pub/?awb={{awb_number}}");

    const edit = await request(app)
      .put("/api/v1/admin/couriers/urbanebolt/endpoints/track")
      .set(ADMIN_AUTH)
      .send({ path: "/v2/track/{{awb_number}}", method: "GET", response: { status_path: "data.state" } });
    expect(edit.status).toBe(200);
    expect(edit.body.data.config.endpoints.track.path).toBe("/v2/track/{{awb_number}}");
    expect(edit.body.data.config.endpoints.create.path).toBe("/services/manifest/"); // untouched

    const reset = await request(app).delete("/api/v1/admin/couriers/urbanebolt/endpoints/track").set(ADMIN_AUTH);
    expect(reset.status).toBe(200);
    expect(reset.body.data.config.endpoints.track.path).toBe("/services/tracking-pub/?awb={{awb_number}}");

    const unknownOp = await request(app).put("/api/v1/admin/couriers/urbanebolt/endpoints/refund").set(ADMIN_AUTH).send({ path: "/x", method: "POST" });
    expect(unknownOp.status).toBe(400);

    const mock = await request(app).put("/api/v1/admin/couriers/mockcourier/endpoints/create").set(ADMIN_AUTH).send({ path: "/x", method: "POST" });
    expect(mock.status).toBe(400);
    expect((await request(app).get("/api/v1/admin/couriers/mockcourier").set(ADMIN_AUTH)).body.data.endpoint_operations).toBeNull();
  });

  it("validates a coded adapter's config against its own schema, not the generic one", async () => {
    const res = await request(app)
      .put("/api/v1/admin/couriers/mockcourier")
      .set(ADMIN_AUTH)
      .send({ display_name: "Hacked", config: validConfig });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("builds up endpoints one at a time, and fails cleanly on a missing one", async () => {
    const create = await request(app)
      .post("/api/v1/admin/couriers")
      .set(ADMIN_AUTH)
      .send({ id: "stepwise", display_name: "Stepwise", config: { base_url: "http://127.0.0.1:9", auth: { type: "none" } } });
    expect(create.status).toBe(201);
    expect(create.body.data.config.endpoints).toEqual({});

    const order = {
      order_id: "ORD-STEPWISE",
      courier_partner: "stepwise",
      pickup_address: { name: "a", phone: "9876543210", line1: "a", city: "a", state: "a", pincode: "1234" },
      delivery_address: { name: "a", phone: "9876543210", line1: "a", city: "a", state: "a", pincode: "1234" },
      package: { weightKg: 1, declaredValue: 1 },
    };
    const missing = await request(app).post("/api/v1/orders").send(order);
    expect(missing.status).toBe(502);
    expect(missing.body.error.code).toBe("COURIER_MISCONFIGURED");

    const add = await request(app)
      .put("/api/v1/admin/couriers/stepwise/endpoints/create")
      .set(ADMIN_AUTH)
      .send({ path: "/shipments", method: "POST", response: { awb_path: "awb" } });
    expect(add.status).toBe(200);
    expect(add.body.data.config.endpoints.create.path).toBe("/shipments");

    const badOp = await request(app)
      .put("/api/v1/admin/couriers/stepwise/endpoints/refund")
      .set(ADMIN_AUTH)
      .send({ path: "/x", method: "POST" });
    expect(badOp.status).toBe(400);

    const remove = await request(app).delete("/api/v1/admin/couriers/stepwise/endpoints/create").set(ADMIN_AUTH);
    expect(remove.status).toBe(200);
    expect(remove.body.data.config.endpoints).toEqual({});

    const withMap = await request(app)
      .put("/api/v1/admin/couriers/stepwise/endpoints/track")
      .set(ADMIN_AUTH)
      .send({ path: "/track", method: "GET", response: { status_path: "state" }, status_map: { shipped: "IN_TRANSIT" } });
    expect(withMap.body.data.config.endpoints.track.status_map).toEqual({ shipped: "IN_TRANSIT" });
  });

  it("keeps the stored secret when the UI sends the mask back, and keeps endpoints on a details update", async () => {
    await request(app)
      .post("/api/v1/admin/couriers")
      .set(ADMIN_AUTH)
      .send({
        id: "keepsecret",
        display_name: "Keep",
        config: { ...validConfig, auth: { type: "bearer_static", token: "real-token" } },
      });

    const update = await request(app)
      .put("/api/v1/admin/couriers/keepsecret")
      .set(ADMIN_AUTH)
      .send({
        display_name: "Keep Renamed",
        config: { base_url: "http://127.0.0.1:9/renamed", auth: { type: "bearer_static", token: "••••••••" } },
      });
    expect(update.status).toBe(200);
    expect(update.body.data.display_name).toBe("Keep Renamed");
    expect(update.body.data.config.base_url).toBe("http://127.0.0.1:9/renamed");
    expect(update.body.data.config.endpoints.create).toBeDefined(); // not wiped

    const { courierPartnerRepository } = await import("../src/repositories/courier-partner.repository");
    const row = await courierPartnerRepository.findById("keepsecret");
    expect((row!.config as any).auth.token).toBe("real-token");
  });

  it("masks secret auth fields when reading back a saved courier", async () => {
    await request(app)
      .post("/api/v1/admin/couriers")
      .set(ADMIN_AUTH)
      .send({
        id: "secretcourier",
        display_name: "Secret Co",
        config: { ...validConfig, auth: { type: "bearer_static", token: "super-secret-value" } },
      });
    const res = await request(app).get("/api/v1/admin/couriers/secretcourier").set(ADMIN_AUTH);
    expect(res.body.data.config.auth.token).not.toBe("super-secret-value");
    expect(JSON.stringify(res.body.data)).not.toContain("super-secret-value");
  });
});
