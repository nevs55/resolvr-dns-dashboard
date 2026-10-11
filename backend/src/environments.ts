import type { Database } from "better-sqlite3";
import { cleanTechnitiumUrl } from "./addon.js";
import type { EnvironmentRow } from "./db.js";

// Everything that reads or writes the environments table lives here, so
// the proxy, config routes, and action routes share one set of accessors
// and one "which environment is this request about" rule instead of three
// copies of the same SQL.

// What callers see. The token is deliberately absent — it is write-only
// and must never leave the backend.
export interface EnvironmentSummary {
  id: number;
  name: string;
  baseUrl: string;
}

export function listEnvironments(db: Database): EnvironmentSummary[] {
  const rows = db.prepare("SELECT id, name, base_url FROM environments ORDER BY id").all() as {
    id: number;
    name: string;
    base_url: string;
  }[];
  return rows.map((r) => ({ id: r.id, name: r.name, baseUrl: r.base_url }));
}

export function getEnvironment(db: Database, id: number): EnvironmentRow | null {
  return (db.prepare("SELECT id, name, base_url, token, created_at FROM environments WHERE id = ?").get(id) as
    | EnvironmentRow
    | undefined) ?? null;
}

function environmentRows(db: Database): EnvironmentRow[] {
  return db.prepare("SELECT id, name, base_url, token, created_at FROM environments ORDER BY id").all() as EnvironmentRow[];
}

export function createEnvironment(db: Database, name: string, baseUrl: string, token: string): EnvironmentRow {
  const info = db.prepare("INSERT INTO environments (name, base_url, token) VALUES (?, ?, ?)").run(name, baseUrl, token);
  return getEnvironment(db, Number(info.lastInsertRowid))!;
}

// `token` may be null to keep the stored token unchanged (the caller never
// sees it, so editing a name or URL must not require re-entering it).
export function updateEnvironment(
  db: Database,
  id: number,
  fields: { name?: string; baseUrl?: string; token?: string | null },
): EnvironmentRow | null {
  const current = getEnvironment(db, id);
  if (!current) return null;
  const name = fields.name ?? current.name;
  const baseUrl = fields.baseUrl ?? current.base_url;
  const token = fields.token === null ? current.token : (fields.token ?? current.token);
  db.prepare("UPDATE environments SET name = ?, base_url = ?, token = ? WHERE id = ?").run(name, baseUrl, token, id);
  return getEnvironment(db, id);
}

export function deleteEnvironment(db: Database, id: number): boolean {
  return db.prepare("DELETE FROM environments WHERE id = ?").run(id).changes > 0;
}

// An environment is "usable" only once it has both a URL and a token.
export function isUsable(env: EnvironmentRow): boolean {
  return Boolean(env.base_url && env.token);
}

// Validates and normalizes a base URL for storage. Only http/https are
// ever accepted; anything else (or anything unparseable) is refused here
// so a malformed or hostile value can never be persisted and later used
// as a fetch target.
export function validateBaseUrl(raw: string): string | null {
  return cleanTechnitiumUrl(raw);
}

export type ResolveResult =
  | { ok: true; env: EnvironmentRow }
  | { ok: false; status: number; error: string; reason: "empty" | "ambiguous" | "invalid" | "not-found" };

// Resolves the `env` request parameter to an environment. Rules:
//   - explicit `env` id → that environment (404 if it does not exist);
//   - no `env` + exactly one environment → that one (single-server compat);
//   - no `env` + zero → 400 "not configured";
//   - no `env` + more than one → 400 "specify env" (never guess).
// A caller can never point the proxy at an arbitrary URL: it can only name
// one of the admin-configured environments, and the stored base URL is
// validated to http/https both on write and again on use.
export function resolveEnvironment(db: Database, raw: unknown): ResolveResult {
  if (raw !== undefined && raw !== null && raw !== "") {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
      return { ok: false, status: 400, error: "env must be a positive integer environment id", reason: "invalid" };
    }
    const env = getEnvironment(db, id);
    if (!env) return { ok: false, status: 404, error: "Environment not found", reason: "not-found" };
    return { ok: true, env };
  }

  const rows = environmentRows(db);
  if (rows.length === 0) {
    return {
      ok: false,
      status: 400,
      error: "No Technitium server is configured yet — ask an admin to set one up.",
      reason: "empty",
    };
  }
  if (rows.length > 1) {
    return {
      ok: false,
      status: 400,
      error: "Multiple servers are configured — specify which environment this is for.",
      reason: "ambiguous",
    };
  }
  return { ok: true, env: rows[0]! };
}
