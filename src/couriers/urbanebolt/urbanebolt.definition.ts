import { z } from "zod";
import { CodedCourierDefinition } from "../coded-courier.definition";
import { endpointSchema, statusMapSchema } from "../generic-rest/config.schema";
import { UrbaneBoltAdapter } from "./urbanebolt.adapter";
import { URBANEBOLT_STATUS_MAP } from "./urbanebolt.types";
import { config } from "../../config";

const urbaneBoltConfigSchema = z.object({
  base_url: z.string().url(),
  username: z.string().default(""),
  password: z.string().default(""),
  customer_code: z.string().default(""),
  default_service_type: z.string().min(1).default("SDD"),
  default_return_email: z.string().email(),
  timeout_ms: z.number().int().positive(),
  retry_max_attempts: z.number().int().positive(),
  retry_base_delay_ms: z.number().int().positive(),
  endpoints: z
    .object({
      auth: endpointSchema.optional(),
      create: endpointSchema.optional(),
      track: endpointSchema.optional(),
      cancel: endpointSchema.optional(),
    })
    .default({}),
  status_map: statusMapSchema.default({}),
});

export type UrbaneBoltConfig = z.infer<typeof urbaneBoltConfigSchema>;

export const URBANEBOLT_DEFAULT_ENDPOINTS: NonNullable<UrbaneBoltConfig["endpoints"]> = {
  auth: {
    path: "/auth/getToken/",
    method: "POST",
    body_template: { username: "{{username}}", password: "{{password}}" },
    response: {}, // token_path unset -> adapter checks the common shapes (token / access / access_token ...)
    status_map: {},
  },
  create: {
    path: "/services/manifest/",
    method: "POST",
    response: {}, // body_template unset -> built-in manifest builder; awb/id found by the built-in extractor
    status_map: { ...URBANEBOLT_STATUS_MAP } as Record<string, any>,
  },
  track: {
    path: "/services/tracking-pub/?awb={{awb_number}}",
    method: "GET",
    response: { status_path: "data.currentStatusCode" }, // confirmed live; description is used as a fallback
    status_map: { ...URBANEBOLT_STATUS_MAP } as Record<string, any>,
  },
  cancel: {
    path: "/services/cancel/",
    method: "POST",
    body_template: { awbs: "{{awb_number}}" },
    response: {},
    status_map: {},
  },
};

export const urbaneBoltDefinition: CodedCourierDefinition<UrbaneBoltConfig> = {
  partnerId: "urbanebolt",
  displayName: "UrbaneBolt",
  configSchema: urbaneBoltConfigSchema,
  defaultConfig: () => ({
    base_url: config.urbanebolt.baseUrl,
    username: config.urbanebolt.username,
    password: config.urbanebolt.password,
    customer_code: config.urbanebolt.customerCode,
    default_service_type: config.urbanebolt.defaultServiceType,
    default_return_email: config.urbanebolt.defaultReturnEmail,
    timeout_ms: config.urbanebolt.timeoutMs,
    retry_max_attempts: config.urbanebolt.retryMaxAttempts,
    retry_base_delay_ms: config.urbanebolt.retryBaseDelayMs,
    endpoints: URBANEBOLT_DEFAULT_ENDPOINTS,
    status_map: {},
  }),
  secretFields: ["password"],
  adminFields: [
    { key: "base_url", label: "Base URL", type: "url" },
    { key: "username", label: "Username", type: "text" },
    { key: "password", label: "Password", type: "password" },
    { key: "customer_code", label: "Customer code", type: "text", help: "issued by UrbaneBolt per account" },
    { key: "default_service_type", label: "Default service type", type: "text", help: "e.g. SDD" },
    { key: "default_return_email", label: "Default return email", type: "email", help: "used when an order has no email" },
    { key: "timeout_ms", label: "Timeout (ms)", type: "number" },
    { key: "retry_max_attempts", label: "Retry attempts", type: "number" },
    { key: "retry_base_delay_ms", label: "Retry base delay (ms)", type: "number" },
  ],
  endpoints: [],
  endpointOperations: ["auth", "create", "track", "cancel"],
  create: (cfg) => new UrbaneBoltAdapter(cfg),
};
