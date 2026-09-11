import { z } from "zod";
import { CodedCourierDefinition } from "../coded-courier.definition";
import { MockCourierAdapter } from "./mock.adapter";

const mockCourierConfigSchema = z.object({
  failure_rate: z.number().min(0).max(1),
  retry_max_attempts: z.number().int().positive(),
  retry_base_delay_ms: z.number().int().positive(),
});

export type MockCourierConfig = z.infer<typeof mockCourierConfigSchema>;

export const mockCourierDefinition: CodedCourierDefinition<MockCourierConfig> = {
  partnerId: "mockcourier",
  displayName: "MockCourier",
  configSchema: mockCourierConfigSchema,
  defaultConfig: () => ({
    failure_rate: 0,
    retry_max_attempts: 3,
    retry_base_delay_ms: 300,
  }),
  secretFields: [],
  adminFields: [
    { key: "failure_rate", label: "Simulated failure rate", type: "number", help: "0 to 1 -- fraction of calls that fail transiently" },
    { key: "retry_max_attempts", label: "Retry attempts", type: "number" },
    { key: "retry_base_delay_ms", label: "Retry base delay (ms)", type: "number" },
  ],
  endpoints: [
    { operation: "create", method: "n/a", path: "in-process, no HTTP call", note: "returns a random MOCK-* id and AWB" },
    { operation: "track", method: "n/a", path: "in-process, no HTTP call", note: "remembers status per order in memory" },
    { operation: "cancel", method: "n/a", path: "in-process, no HTTP call" },
  ],
  create: (cfg) => new MockCourierAdapter(cfg),
};
