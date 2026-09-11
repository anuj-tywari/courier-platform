import { z } from "zod";
import { courierPartnerRepository, CourierPartnerRow } from "../repositories/courier-partner.repository";
import { courierRegistry } from "../couriers/registry";
import { AdminField, CodedEndpoint } from "../couriers/coded-courier.definition";
import { GenericRestCourierAdapter } from "../couriers/generic-rest/generic-rest.adapter";
import {
  GenericRestConfig,
  EndpointConfig,
  OPERATIONS,
  GENERIC_REST_SECRET_FIELDS,
  preserveGenericRestSecrets,
  genericRestConfigSchema,
} from "../couriers/generic-rest/config.schema";
import { maskSecrets, preserveSecrets } from "../couriers/base/secrets";
import { AppError, ErrorCode } from "../types/errors";

interface CourierPartnerDto {
  id: string;
  display_name: string;
  kind: "code" | "generic_rest";
  enabled: boolean;
  config: Record<string, unknown> | null; // secrets masked
  fields: AdminField[] | null;
  endpoints: CodedEndpoint[] | null;
  endpoint_operations: string[] | null;
  created_at: string;
  updated_at: string;
}

function secretPaths(row: CourierPartnerRow): string[] {
  if (row.kind === "generic_rest") return GENERIC_REST_SECRET_FIELDS;
  return courierRegistry.definition(row.id)?.secretFields ?? [];
}

function toDto(row: CourierPartnerRow): CourierPartnerDto {
  return {
    id: row.id,
    display_name: row.display_name,
    kind: row.kind,
    enabled: row.enabled,
    config: row.config ? maskSecrets(row.config as Record<string, unknown>, secretPaths(row)) : null,
    fields: row.kind === "code" ? courierRegistry.definition(row.id)?.adminFields ?? [] : null,
    endpoints: row.kind === "code" ? courierRegistry.definition(row.id)?.endpoints ?? [] : null,
    endpoint_operations:
      row.kind === "generic_rest" ? [...OPERATIONS] : courierRegistry.definition(row.id)?.endpointOperations ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function parseConfig<T>(schema: z.ZodType<T, any, any>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => ({ field: `config.${issue.path.join(".")}`, message: issue.message }));
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Request validation failed", { fields });
  }
  return result.data;
}

const LAST_ACTIVE_MESSAGE = "At least one courier partner must stay active. Activate another courier first.";

class CourierAdminService {
  async list(): Promise<CourierPartnerDto[]> {
    const rows = await courierPartnerRepository.list();
    return rows.map(toDto);
  }

  async getById(id: string): Promise<CourierPartnerDto> {
    const row = await this.existing(id);
    return toDto(row);
  }

  private async existing(id: string): Promise<CourierPartnerRow> {
    const row = await courierPartnerRepository.findById(id.toLowerCase());
    if (!row) throw new AppError(ErrorCode.ORDER_NOT_FOUND, `No courier_partner "${id}"`);
    return row;
  }

  private async endpointsTarget(id: string, operation?: string) {
    const row = await this.existing(id);
    const def = row.kind === "code" ? courierRegistry.definition(row.id) : undefined;
    const operations: readonly string[] = row.kind === "generic_rest" ? OPERATIONS : def?.endpointOperations ?? [];
    if (!operations.length) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, `courier_partner "${id}" has no configurable endpoints`);
    }
    if (operation && !operations.includes(operation)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, `Unknown endpoint "${operation}"`, {
        fields: [{ field: "operation", message: `must be one of ${operations.join(", ")}` }],
      });
    }
    const schema = def ? def.configSchema : genericRestConfigSchema;
    const config = schema.parse(row.config) as { endpoints: Record<string, unknown>; status_map: Record<string, string> };
    return { row, def, config };
  }

  private async saveConfig(id: string, displayName: string, config: unknown): Promise<CourierPartnerDto> {
    await courierPartnerRepository.updateConfig(id.toLowerCase(), { displayName, config });
    await courierRegistry.reload();
    return this.getById(id);
  }

  private async assertAnotherStaysActive(losingIds: string[]): Promise<void> {
    const rows = await courierPartnerRepository.list();
    const remaining = rows.filter((r) => r.enabled && !losingIds.includes(r.id));
    if (remaining.length === 0) throw new AppError(ErrorCode.VALIDATION_ERROR, LAST_ACTIVE_MESSAGE);
  }

  async create(input: { id: string; displayName: string; config: GenericRestConfig }): Promise<CourierPartnerDto> {
    try {
      const row = await courierPartnerRepository.create({ id: input.id.toLowerCase(), displayName: input.displayName, config: input.config });
      await courierRegistry.reload();
      return toDto(row);
    } catch (err: any) {
      if (err.code === "DUPLICATE") {
        throw new AppError(ErrorCode.VALIDATION_ERROR, err.message, { fields: [{ field: "id", message: "already in use" }] });
      }
      throw err;
    }
  }

  async update(id: string, input: { displayName: string; config?: unknown }): Promise<CourierPartnerDto> {
    const row = await this.existing(id);

    if (input.config === undefined) {
      await courierPartnerRepository.updateDisplayName(row.id, input.displayName);
      return this.getById(id);
    }

    if (row.kind === "code") {
      const def = courierRegistry.definition(row.id);
      if (!def) throw new AppError(ErrorCode.INTERNAL_ERROR, `No definition registered for coded courier "${id}"`);
      const config = preserveSecrets(parseConfig(def.configSchema, input.config), row.config, def.secretFields) as Record<string, unknown>;
      if (def.endpointOperations) {
        const existing = def.configSchema.parse(row.config) as Record<string, unknown>;
        config.endpoints = existing.endpoints;
        config.status_map = existing.status_map;
      }
      return this.saveConfig(row.id, input.displayName, config);
    }

    const existing = genericRestConfigSchema.parse(row.config);
    const merged = preserveGenericRestSecrets(parseConfig(genericRestConfigSchema, input.config), existing);
    merged.endpoints = existing.endpoints;
    merged.status_map = existing.status_map;
    return this.saveConfig(row.id, input.displayName, merged);
  }

  async upsertEndpoint(id: string, operation: string, endpoint: EndpointConfig): Promise<CourierPartnerDto> {
    const { row, config } = await this.endpointsTarget(id, operation);
    config.endpoints = { ...config.endpoints, [operation]: endpoint };
    return this.saveConfig(row.id, row.display_name, config);
  }

  async removeEndpoint(id: string, operation: string): Promise<CourierPartnerDto> {
    const { row, def, config } = await this.endpointsTarget(id, operation);
    const { [operation]: _removed, ...rest } = config.endpoints;
    config.endpoints = rest;
    if (def) {
      const fallback = (def.defaultConfig() as { endpoints?: Record<string, unknown> }).endpoints?.[operation];
      if (fallback) config.endpoints = { ...rest, [operation]: fallback };
    }
    return this.saveConfig(row.id, row.display_name, config);
  }

  async setEnabled(id: string, enabled: boolean): Promise<CourierPartnerDto> {
    const row = await this.existing(id);
    if (!enabled) await this.assertAnotherStaysActive([row.id]);
    await courierPartnerRepository.setEnabled(row.id, enabled);
    await courierRegistry.reload();
    return this.getById(id);
  }

  async setEnabledBulk(ids: string[], enabled: boolean): Promise<CourierPartnerDto[]> {
    const lower = ids.map((id) => id.toLowerCase());
    if (!enabled) await this.assertAnotherStaysActive(lower);
    await courierPartnerRepository.setEnabledBulk(lower, enabled);
    await courierRegistry.reload();
    return Promise.all(ids.map((id) => this.getById(id)));
  }

  async remove(id: string): Promise<void> {
    const row = await this.existing(id);
    await this.assertAnotherStaysActive([row.id]);
    await courierPartnerRepository.softDelete(row.id);
    await courierRegistry.reload();
  }
  async testConnection(rawConfig: unknown, existingId?: string): Promise<{ ok: boolean; message: string }> {
    const row = existingId ? await courierPartnerRepository.findById(existingId.toLowerCase()) : undefined;
    let adapter;
    if (row?.kind === "code") {
      const def = courierRegistry.definition(row.id)!;
      adapter = def.create(preserveSecrets(parseConfig(def.configSchema, rawConfig), row.config, def.secretFields));
    } else {
      let config: GenericRestConfig = parseConfig(genericRestConfigSchema, rawConfig);
      if (row) config = preserveGenericRestSecrets(config, genericRestConfigSchema.parse(row.config));
      adapter = new GenericRestCourierAdapter("__test__", "Test", config);
    }
    try {
      await adapter.authenticate();
      return { ok: true, message: "Authentication succeeded (or no authentication required)." };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }
}

export const courierAdminService = new CourierAdminService();
