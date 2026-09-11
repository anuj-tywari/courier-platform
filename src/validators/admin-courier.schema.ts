import { z } from "zod";
import { genericRestConfigSchema, endpointSchema } from "../couriers/generic-rest/config.schema";

const courierId = z
  .string()
  .min(2)
  .max(32)
  .regex(/^[a-z][a-z0-9_-]*$/, "must be lowercase, start with a letter, and contain only letters/digits/-/_");

export const createCourierSchema = z.object({
  id: courierId,
  display_name: z.string().min(1).max(100),
  config: genericRestConfigSchema,
});

export const updateCourierSchema = z.object({
  display_name: z.string().min(1).max(100),
  config: z.record(z.string(), z.unknown()).optional(),
});

export const upsertEndpointSchema = endpointSchema;

export const setEnabledSchema = z.object({
  enabled: z.boolean(),
});

export const bulkSetEnabledSchema = z.object({
  ids: z.array(courierId).min(1),
  enabled: z.boolean(),
});

export const testConnectionSchema = z.object({
  config: z.record(z.string(), z.unknown()),
  id: courierId.optional(),
});
