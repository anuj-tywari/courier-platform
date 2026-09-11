
import { ICourierAdapter } from "./courier-adapter.interface";
import { CodedCourierDefinition } from "./coded-courier.definition";
import { urbaneBoltDefinition } from "./urbanebolt/urbanebolt.definition";
import { mockCourierDefinition } from "./mock/mock.definition";
import { GenericRestCourierAdapter } from "./generic-rest/generic-rest.adapter";
import { genericRestConfigSchema } from "./generic-rest/config.schema";
import { AppError, ErrorCode } from "../types/errors";
import { courierPartnerRepository } from "../repositories/courier-partner.repository";
import { logger } from "../utils/logger";

class CourierRegistry {
  private definitions = new Map<string, CodedCourierDefinition>();
  private liveAdapters = new Map<string, ICourierAdapter>();
  private enabled = new Map<string, boolean>();

  register(definition: CodedCourierDefinition) {
    this.definitions.set(definition.partnerId, definition);
  }

  definition(partnerId: string): CodedCourierDefinition | undefined {
    return this.definitions.get(partnerId?.toLowerCase());
  }

  async initialize(): Promise<void> {
    for (const def of this.definitions.values()) {
      await courierPartnerRepository.seedCodeAdapter(def.partnerId, def.displayName, def.defaultConfig());
    }
    await this.reload();
  }

  async reload(): Promise<void> {
    const rows = await courierPartnerRepository.list();
    const live = new Map<string, ICourierAdapter>();
    const enabled = new Map<string, boolean>();

    for (const row of rows) {
      enabled.set(row.id, row.enabled);
      try {
        if (row.kind === "code") {
          const def = this.definitions.get(row.id);
          if (!def) {
            logger.warn({ courier_partner: row.id }, "coded courier row has no registered definition, skipping");
            continue;
          }
          live.set(row.id, def.create(def.configSchema.parse(row.config ?? def.defaultConfig())));
        } else {
          live.set(row.id, new GenericRestCourierAdapter(row.id, row.display_name, genericRestConfigSchema.parse(row.config)));
        }
      } catch (err) {
        logger.error({ courier_partner: row.id, err }, "failed to load courier config, skipping");
      }
    }

    this.liveAdapters = live;
    this.enabled = enabled;
  }

  get(partnerId: string): ICourierAdapter {
    const id = partnerId?.toLowerCase();
    const adapter = this.liveAdapters.get(id);
    if (!adapter) {
      throw new AppError(ErrorCode.UNKNOWN_COURIER, `Unknown courier_partner "${partnerId}"`, {
        supported_couriers: this.supportedPartners(),
      });
    }
    if (!this.enabled.get(id)) {
      throw new AppError(ErrorCode.COURIER_DISABLED, `courier_partner "${partnerId}" is currently disabled`, {
        supported_couriers: this.supportedPartners(),
      });
    }
    return adapter;
  }

  supportedPartners(): string[] {
    return Array.from(this.liveAdapters.keys()).filter((id) => this.enabled.get(id));
  }
}

export const courierRegistry = new CourierRegistry();

courierRegistry.register(urbaneBoltDefinition);
courierRegistry.register(mockCourierDefinition);
