
import { z } from "zod";
import { ICourierAdapter } from "./courier-adapter.interface";

export interface AdminField {
  key: string;
  label: string;
  type: "text" | "password" | "number" | "url" | "email";
  help?: string;
}

export interface CodedEndpoint {
  operation: string;
  method: string;
  path: string;
  note?: string;
}

export interface CodedCourierDefinition<C = any> {
  partnerId: string;
  displayName: string;
  configSchema: z.ZodType<C, any, any>;
  defaultConfig: () => C;
  secretFields: string[]; // dot-paths masked in admin responses
  adminFields: AdminField[];
  endpoints: CodedEndpoint[];
  endpointOperations?: string[];
  create: (config: C) => ICourierAdapter;
}
