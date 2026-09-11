import { describe, it, expect, beforeAll } from "vitest";
import { resetDb } from "./helpers/test-db";

let courierRegistry: typeof import("../src/couriers/registry").courierRegistry;
let AppError: typeof import("../src/types/errors").AppError;
let ErrorCode: typeof import("../src/types/errors").ErrorCode;

beforeAll(async () => {
  await resetDb();
  ({ courierRegistry } = await import("../src/couriers/registry"));
  ({ AppError, ErrorCode } = await import("../src/types/errors"));
  await courierRegistry.initialize();
});

describe("CourierRegistry", () => {
  it("resolves a known courier by partner id", () => {
    const adapter = courierRegistry.get("mockcourier");
    expect(adapter.partnerId).toBe("mockcourier");
  });

  it("is case-insensitive on courier_partner", () => {
    const adapter = courierRegistry.get("MockCourier");
    expect(adapter.partnerId).toBe("mockcourier");
  });

  it("throws a normalized UNKNOWN_COURIER AppError listing supported couriers", () => {
    try {
      courierRegistry.get("dhl");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as InstanceType<typeof AppError>).code).toBe(ErrorCode.UNKNOWN_COURIER);
      expect((err as InstanceType<typeof AppError>).httpStatus).toBe(400);
      expect((err as InstanceType<typeof AppError>).details).toMatchObject({
        supported_couriers: expect.arrayContaining(["urbanebolt", "mockcourier"]),
      });
    }
  });

  it("throws COURIER_DISABLED for a registered but disabled courier", async () => {
    const { courierPartnerRepository } = await import("../src/repositories/courier-partner.repository");
    await courierPartnerRepository.setEnabled("mockcourier", false);
    await courierRegistry.reload();
    try {
      courierRegistry.get("mockcourier");
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as InstanceType<typeof AppError>).code).toBe(ErrorCode.COURIER_DISABLED);
    } finally {
      await courierPartnerRepository.setEnabled("mockcourier", true);
      await courierRegistry.reload();
    }
  });
});
