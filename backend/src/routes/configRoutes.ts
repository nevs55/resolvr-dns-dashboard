import { Router, type Request, type Response } from "express";
import type { Database } from "better-sqlite3";
import { pingTechnitium } from "../technitiumPing.js";
import {
  createEnvironment,
  deleteEnvironment,
  getEnvironment,
  isUsable,
  listEnvironments,
  resolveEnvironment,
  updateEnvironment,
  validateBaseUrl,
  type EnvironmentSummary,
} from "../environments.js";
import type { EnvironmentRow } from "../db.js";
import type { AuthedRequest } from "../auth.js";

export interface ConfigRoutesOptions {
  fetchImpl?: typeof fetch;
  // The connection is set outside the app (the Home Assistant add-on's
  // Configuration tab), so it cannot be changed or read back from here.
  managed?: boolean;
}

function toSummary(env: EnvironmentRow): EnvironmentSummary {
  return { id: env.id, name: env.name, baseUrl: env.base_url };
}

// The list is read-only (and token-free) for any signed-in role — viewers
// need it to build the environment switcher. Mutations are gated to admin
// inside the router below.
export function environmentsRoutes(db: Database, options: ConfigRoutesOptions = {}): Router {
  const fetchImpl = options.fetchImpl ?? fetch;
  const managed = options.managed ?? false;
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({ environments: listEnvironments(db), managed });
  });

  // Admin-only from here down. requireAuth already ran at mount in app.ts;
  // this only rejects non-admins (and unauthenticated requests, defensively).
  router.post("/", async (req, res) => {
    if ((req as AuthedRequest).user?.role !== "admin") {
      res.status(403).json({ error: "Admin role required" });
      return;
    }
    if (managed) {
      res.status(409).json({ error: "The connection is set in the add-on's Configuration tab. Change it there and restart the add-on." });
      return;
    }
    const { name, baseUrl, token } = req.body ?? {};
    if (typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const cleanUrl = typeof baseUrl === "string" ? validateBaseUrl(baseUrl) : null;
    if (!cleanUrl) {
      res.status(400).json({ error: "baseUrl must be a web address starting with http:// or https://" });
      return;
    }
    if (typeof token !== "string" || !token.trim()) {
      res.status(400).json({ error: "token is required" });
      return;
    }
    const result = await pingTechnitium(cleanUrl, token.trim(), fetchImpl);
    if (!result.ok) {
      res.status(400).json({ error: result.error ?? "Could not connect to the server" });
      return;
    }
    const created = createEnvironment(db, name.trim(), cleanUrl, token.trim());
    res.json({ environment: toSummary(created), serverDomain: result.serverDomain, serverVersion: result.serverVersion });
  });

  router.put("/:id", async (req, res) => {
    if ((req as AuthedRequest).user?.role !== "admin") {
      res.status(403).json({ error: "Admin role required" });
      return;
    }
    if (managed) {
      res.status(409).json({ error: "The connection is set in the add-on's Configuration tab. Change it there and restart the add-on." });
      return;
    }
    const id = Number(req.params.id);
    const current = getEnvironment(db, id);
    if (!current) {
      res.status(404).json({ error: "Environment not found" });
      return;
    }
    const { name, baseUrl, token } = req.body ?? {};
    if (name !== undefined && (typeof name !== "string" || !name.trim())) {
      res.status(400).json({ error: "name must be a non-empty string" });
      return;
    }
    if (baseUrl !== undefined && (typeof baseUrl !== "string" || !validateBaseUrl(baseUrl))) {
      res.status(400).json({ error: "baseUrl must be a web address starting with http:// or https://" });
      return;
    }
    if (token !== undefined && typeof token !== "string") {
      res.status(400).json({ error: "token must be a string" });
      return;
    }

    const nextName = name !== undefined ? name.trim() : current.name;
    const nextUrl = baseUrl !== undefined ? validateBaseUrl(baseUrl)! : current.base_url;
    // Empty/omitted token keeps the stored one (it is write-only, so an
    // admin editing the name or URL cannot be shown the current value).
    const nextToken = token !== undefined && token.trim() !== "" ? token.trim() : current.token;

    const result = await pingTechnitium(nextUrl, nextToken, fetchImpl);
    if (!result.ok) {
      res.status(400).json({ error: result.error ?? "Could not connect to the server" });
      return;
    }
    const updated = updateEnvironment(db, id, { name: nextName, baseUrl: nextUrl, token: nextToken })!;
    res.json({ environment: toSummary(updated), serverDomain: result.serverDomain, serverVersion: result.serverVersion });
  });

  router.delete("/:id", (req, res) => {
    if ((req as AuthedRequest).user?.role !== "admin") {
      res.status(403).json({ error: "Admin role required" });
      return;
    }
    if (managed) {
      res.status(409).json({ error: "The connection is set in the add-on's Configuration tab. Change it there and restart the add-on." });
      return;
    }
    const id = Number(req.params.id);
    if (!deleteEnvironment(db, id)) {
      res.status(404).json({ error: "Environment not found" });
      return;
    }
    res.json({ status: "ok" });
  });

  return router;
}

// Per-environment connectivity, polled by the frontend for the currently
// selected environment. Same shape as the old single-server status, so a
// single-server install behaves exactly as it did before.
export function statusRoute(db: Database, options: ConfigRoutesOptions = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  return async (req: Request, res: Response) => {
    const resolved = resolveEnvironment(db, req.query.env);
    if (!resolved.ok) {
      if (resolved.reason === "empty") {
        res.json({ configured: false, connected: false, serverDomain: null, serverVersion: null });
        return;
      }
      res.status(resolved.status).json({ error: resolved.error });
      return;
    }
    const env = resolved.env;
    if (!isUsable(env)) {
      res.json({ configured: false, connected: false, serverDomain: null, serverVersion: null });
      return;
    }
    const result = await pingTechnitium(env.base_url, env.token, fetchImpl);
    res.json({
      configured: true,
      connected: result.ok,
      serverDomain: result.serverDomain ?? null,
      serverVersion: result.serverVersion ?? null,
      error: result.ok ? null : result.error,
    });
  };
}

// ---------- global overview ----------

const OVERVIEW_WINDOW = "LastHour";
const OVERVIEW_TIMEOUT_MS = 5000;

interface BlockedStats {
  totalQueries: number;
  totalBlocked: number;
}

async function fetchBlockedStats(baseUrl: string, token: string, fetchImpl: typeof fetch): Promise<BlockedStats> {
  const target = new URL("/api/dashboard/stats/get", baseUrl);
  target.searchParams.set("type", OVERVIEW_WINDOW);
  const res = await fetchImpl(target, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(OVERVIEW_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Technitium responded ${res.status}`);
  const body = (await res.json()) as {
    status?: string;
    errorMessage?: string;
    response?: { stats?: { totalQueries?: number; totalBlocked?: number } };
  };
  if (body.status && body.status !== "ok") {
    throw new Error(body.errorMessage ?? `Technitium returned status ${body.status}`);
  }
  const stats = body.response?.stats ?? {};
  return { totalQueries: stats.totalQueries ?? 0, totalBlocked: stats.totalBlocked ?? 0 };
}

interface OverviewEntry {
  id: number;
  name: string;
  connected: boolean;
  serverDomain: string | null;
  serverVersion: string | null;
  // Present only when the server answered the stats query. Absent (null)
  // when it is down or timing out — never a fabricated 0 total.
  totalQueries: number | null;
  totalBlocked: number | null;
  error: string | null;
}

// Health + blocked-stat snapshot of every environment, gathered with a
// common time window. Each server is queried independently and a partial
// failure (one server down or timing out) degrades only that row — it is
// reported honestly rather than folded into a misleading zero total.
export function overviewRoute(db: Database, options: ConfigRoutesOptions = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  return async (_req: Request, res: Response) => {
    const envs = listEnvironments(db).map((s) => getEnvironment(db, s.id)!);

    const results = await Promise.all(
      envs.map(async (env): Promise<OverviewEntry> => {
        if (!env.base_url || !env.token) {
          return {
            id: env.id,
            name: env.name,
            connected: false,
            serverDomain: null,
            serverVersion: null,
            totalQueries: null,
            totalBlocked: null,
            error: null,
          };
        }
        const ping = await pingTechnitium(env.base_url, env.token, fetchImpl);
        if (!ping.ok) {
          return {
            id: env.id,
            name: env.name,
            connected: false,
            serverDomain: null,
            serverVersion: null,
            totalQueries: null,
            totalBlocked: null,
            error: ping.error ?? "Could not reach the server",
          };
        }
        try {
          const stats = await fetchBlockedStats(env.base_url, env.token, fetchImpl);
          return {
            id: env.id,
            name: env.name,
            connected: true,
            serverDomain: ping.serverDomain ?? null,
            serverVersion: ping.serverVersion ?? null,
            totalQueries: stats.totalQueries,
            totalBlocked: stats.totalBlocked,
            error: null,
          };
        } catch (err) {
          return {
            id: env.id,
            name: env.name,
            connected: true,
            serverDomain: ping.serverDomain ?? null,
            serverVersion: ping.serverVersion ?? null,
            totalQueries: null,
            totalBlocked: null,
            error: `Could not read statistics: ${(err as Error).message}`,
          };
        }
      }),
    );

    res.json({ window: OVERVIEW_WINDOW, environments: results });
  };
}
