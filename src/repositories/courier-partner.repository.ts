import { pool } from "../db/client";

type CourierKind = "code" | "generic_rest";

export interface CourierPartnerRow {
  id: string;
  display_name: string;
  kind: CourierKind;
  enabled: boolean;
  config: unknown | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

const UNIQUE_VIOLATION = "23505";

function seedMerge(existing: unknown, defaults: unknown): unknown {
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) return defaults;
  if (!defaults || typeof defaults !== "object" || Array.isArray(defaults)) return existing;

  const merged: Record<string, unknown> = { ...(defaults as Record<string, unknown>) };
  for (const [key, value] of Object.entries(existing as Record<string, unknown>)) {
    const fallback = merged[key];
    if (value === "" && typeof fallback === "string" && fallback) continue;
    if (value && typeof value === "object" && !Array.isArray(value) && fallback && typeof fallback === "object" && !Array.isArray(fallback)) {
      merged[key] = seedMerge(value, fallback);
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

class CourierPartnerRepository {
  async list(): Promise<CourierPartnerRow[]> {
    const res = await pool.query<CourierPartnerRow>(
      "SELECT * FROM courier_partners WHERE deleted_at IS NULL ORDER BY created_at ASC"
    );
    return res.rows;
  }

  async findById(id: string): Promise<CourierPartnerRow | undefined> {
    const res = await pool.query<CourierPartnerRow>(
      "SELECT * FROM courier_partners WHERE id = $1 AND deleted_at IS NULL",
      [id]
    );
    return res.rows[0];
  }

  private async findByIdIncludingDeleted(id: string): Promise<CourierPartnerRow | undefined> {
    const res = await pool.query<CourierPartnerRow>("SELECT * FROM courier_partners WHERE id = $1", [id]);
    return res.rows[0];
  }

  async seedCodeAdapter(id: string, displayName: string, defaultConfig: unknown): Promise<void> {
    const now = new Date().toISOString();
    const existing = await this.findByIdIncludingDeleted(id);

    if (!existing) {
      await pool.query(
        `INSERT INTO courier_partners (id, display_name, kind, enabled, config, created_at, updated_at)
         VALUES ($1, $2, 'code', true, $3, $4, $4)`,
        [id, displayName, JSON.stringify(defaultConfig), now]
      );
      return;
    }

    if (existing.kind !== "code") return;

    const merged = seedMerge(existing.config, defaultConfig);
    await pool.query(
      `UPDATE courier_partners
       SET config = $2, deleted_at = NULL, updated_at = $3
       WHERE id = $1`,
      [id, JSON.stringify(merged), now]
    );
  }

  async create(row: { id: string; displayName: string; config: unknown }): Promise<CourierPartnerRow> {
    const now = new Date().toISOString();
    const existing = await this.findByIdIncludingDeleted(row.id);

    if (existing && existing.deleted_at === null) {
      throw Object.assign(new Error(`courier_partner "${row.id}" already exists`), { code: "DUPLICATE" });
    }
    if (existing && existing.kind === "code") {
      throw Object.assign(new Error(`courier_partner "${row.id}" is a built-in adapter that was deleted`), {
        code: "DUPLICATE",
      });
    }

    if (existing) {
      await pool.query(
        `UPDATE courier_partners
         SET display_name = $2, kind = 'generic_rest', enabled = true, config = $3,
             deleted_at = NULL, updated_at = $4
         WHERE id = $1`,
        [row.id, row.displayName, JSON.stringify(row.config), now]
      );
    } else {
      try {
        await pool.query(
          `INSERT INTO courier_partners (id, display_name, kind, enabled, config, created_at, updated_at)
           VALUES ($1, $2, 'generic_rest', true, $3, $4, $4)`,
          [row.id, row.displayName, JSON.stringify(row.config), now]
        );
      } catch (err: any) {
        if (err.code === UNIQUE_VIOLATION) {
          throw Object.assign(new Error(`courier_partner "${row.id}" already exists`), { code: "DUPLICATE" });
        }
        throw err;
      }
    }
    return (await this.findById(row.id))!;
  }

  async updateConfig(id: string, row: { displayName: string; config: unknown }): Promise<void> {
    await pool.query(
      `UPDATE courier_partners SET display_name = $2, config = $3, updated_at = $4
       WHERE id = $1 AND deleted_at IS NULL`,
      [id, row.displayName, JSON.stringify(row.config), new Date().toISOString()]
    );
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await pool.query("UPDATE courier_partners SET enabled = $2, updated_at = $3 WHERE id = $1 AND deleted_at IS NULL", [
      id,
      enabled,
      new Date().toISOString(),
    ]);
  }

  async setEnabledBulk(ids: string[], enabled: boolean): Promise<void> {
    await pool.query(
      "UPDATE courier_partners SET enabled = $2, updated_at = $3 WHERE id = ANY($1::text[]) AND deleted_at IS NULL",
      [ids, enabled, new Date().toISOString()]
    );
  }

  async updateDisplayName(id: string, displayName: string): Promise<void> {
    await pool.query("UPDATE courier_partners SET display_name = $2, updated_at = $3 WHERE id = $1 AND deleted_at IS NULL", [
      id,
      displayName,
      new Date().toISOString(),
    ]);
  }

  async softDelete(id: string): Promise<void> {
    await pool.query(
      `UPDATE courier_partners SET deleted_at = $2, enabled = false, updated_at = $2
       WHERE id = $1 AND deleted_at IS NULL`,
      [id, new Date().toISOString()]
    );
  }
}

export const courierPartnerRepository = new CourierPartnerRepository();
