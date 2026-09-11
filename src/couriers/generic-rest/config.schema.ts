
import { z } from "zod";
import { preserveSecrets } from "../base/secrets";

const httpMethod = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);

const authSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("api_key_header"), header_name: z.string().min(1), api_key: z.string().min(1) }),
  z.object({ type: z.literal("basic"), username: z.string().min(1), password: z.string().min(1) }),
  z.object({ type: z.literal("bearer_static"), token: z.string().min(1) }),
  z.object({
    type: z.literal("login_bearer"),
    login_path: z.string().min(1),
    login_method: httpMethod.default("POST"),
    body_template: z.record(z.string(), z.unknown()),
    username: z.string().min(1),
    password: z.string().min(1),
    token_path: z.string().min(1),
    header_name: z.string().default("Authorization"),
    header_prefix: z.string().default("Bearer "),
    token_ttl_ms: z.number().int().positive().default(15 * 60 * 1000),
  }),
]);

const responseMapping = z.object({
  courier_order_id_path: z.string().optional(),
  awb_path: z.string().optional(),
  status_path: z.string().optional(),
  token_path: z.string().optional(), // only meaningful for an "auth" endpoint
});

export const statusMapSchema = z.record(
  z.string(),
  z.enum(["CREATED", "PICKED_UP", "IN_TRANSIT", "DELIVERED", "CANCELLED", "FAILED"])
);

export const endpointSchema = z.object({
  path: z.string().min(1), // may contain {{order_id}} / {{courier_order_id}} / {{awb_number}} tokens
  method: httpMethod,
  body_template: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]).optional(),
  response: responseMapping.default({}),
  status_map: statusMapSchema.default({}),
});

export const OPERATIONS = ["create", "track", "cancel"] as const;
export type Operation = (typeof OPERATIONS)[number];

export const genericRestConfigSchema = z.object({
  base_url: z.string().url(),
  timeout_ms: z.number().int().positive().default(8000),
  retry: z
    .object({
      max_attempts: z.number().int().positive().default(3),
      base_delay_ms: z.number().int().positive().default(300),
    })
    .default({ max_attempts: 3, base_delay_ms: 300 }),
  auth: authSchema,
  endpoints: z
    .object({
      create: endpointSchema.optional(),
      track: endpointSchema.optional(),
      cancel: endpointSchema.optional(),
    })
    .default({}),
  status_map: statusMapSchema.default({}),
});

export type GenericRestConfig = z.infer<typeof genericRestConfigSchema>;
export type EndpointConfig = z.infer<typeof endpointSchema>;

export const GENERIC_REST_SECRET_FIELDS = ["auth.api_key", "auth.password", "auth.token"];
export function preserveGenericRestSecrets(incoming: GenericRestConfig, existing: GenericRestConfig | null): GenericRestConfig {
  if (!existing || incoming.auth.type !== existing.auth.type) return incoming;
  return preserveSecrets(incoming, existing, GENERIC_REST_SECRET_FIELDS);
}
