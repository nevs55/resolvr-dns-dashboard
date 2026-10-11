import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { isAllowedPath } from "./proxyAllowlist.js";
import { openDb } from "./db.js";
import { attachUser, requireAuth, requireAdmin } from "./auth.js";
import { authRoutes } from "./routes/authRoutes.js";
import { userRoutes } from "./routes/userRoutes.js";
import { environmentsRoutes, statusRoute, overviewRoute } from "./routes/configRoutes.js";
import { actionRoutes } from "./routes/actionRoutes.js";
import { resolveEnvironment, validateBaseUrl } from "./environments.js";
import { serveFrontend } from "./frontend.js";
import type { AddonMode } from "./addon.js";

export interface CreateAppOptions {
  frontendOrigin?: string;
  fetchImpl?: typeof fetch;
  db?: import("better-sqlite3").Database;
  // Set when running as a Home Assistant add-on (see addon.ts).
  addon?: AddonMode | null;
  // Directory of the built web app to serve from this same process.
  staticDir?: string;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const frontendOrigin = options.frontendOrigin ?? process.env.FRONTEND_ORIGIN;
  const fetchImpl = options.fetchImpl ?? fetch;
  const db = options.db ?? openDb();

  const app = express();
  // With no FRONTEND_ORIGIN configured, reflect whatever Origin the
  // browser sends (cors' `origin: true`) instead of a single hardcoded
  // default — this app has no fixed "the frontend" address: it's
  // commonly reached via localhost, a LAN IP, or a hostname depending
  // on the device viewing it (confirmed live: a Raspberry Pi deploy
  // reached from another device's browser got CORS-blocked because the
  // origin didn't match a hardcoded http://localhost:8080). This is
  // safe to reflect because the session cookie is SameSite=Lax, which
  // Chrome/Firefox/Safari never attach to a cross-site fetch/XHR
  // regardless of what CORS allows — only a matching-origin request can
  // ever carry it. Set FRONTEND_ORIGIN explicitly to lock this down to
  // one exact origin instead.
  app.use(cors({ origin: frontendOrigin ?? true, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());
  app.use(attachUser(db, { trustedIngressPeers: options.addon?.trustedPeers }));

  // Docker deployments have nothing else scraping request activity, so
  // without this `docker logs` shows nothing at all for the backend
  // container regardless of what's actually happening.
  app.use((req: Request, res: Response, next) => {
    const start = Date.now();
    res.on("finish", () => {
      console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
    });
    next();
  });

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api/auth", authRoutes(db));
  if (options.addon) {
    // Home Assistant owns sign-in, so there are no Resolvr accounts to manage.
    app.use("/api/users", (_req, res) => {
      res.status(404).json({ error: "Users are managed by Home Assistant." });
    });
  } else {
    app.use("/api/users", requireAdmin, userRoutes(db));
  }
  // The environment list is available to any signed-in role (the switcher
  // needs it); create/update/delete are gated to admin inside the router.
  app.use("/api/environments", requireAuth, environmentsRoutes(db, { fetchImpl, managed: options.addon?.managed ?? false }));
  app.get("/api/status", requireAuth, statusRoute(db, { fetchImpl }));
  app.get("/api/overview", requireAuth, overviewRoute(db, { fetchImpl }));
  app.use("/api/actions", requireAdmin, actionRoutes(db, { fetchImpl }));

  app.all("/api/technitium/*splat", requireAuth, async (req: Request, res: Response) => {
    if (req.method !== "GET") {
      res.status(403).json({ error: "Only GET requests are allowed through this proxy" });
      return;
    }

    // The target environment is named by the `env` query parameter, never
    // by a client-supplied URL — a caller can only select one of the
    // admin-configured environments.
    const resolved = resolveEnvironment(db, req.query.env);
    if (!resolved.ok) {
      res.status(resolved.status).json({ error: resolved.error });
      return;
    }
    const env = resolved.env;
    if (!env.base_url || !env.token) {
      res.status(400).json({ error: "No Technitium server is configured yet — ask an admin to set one up." });
      return;
    }
    // Defense in depth: re-validate the stored URL before using it as a
    // fetch target, so a value that slipped past validation at write time
    // still cannot redirect the proxy to a non-http(s) destination.
    const baseUrl = validateBaseUrl(env.base_url);
    if (!baseUrl) {
      res.status(502).json({ error: `Invalid configured server URL: ${env.base_url}` });
      return;
    }

    const splat = req.params.splat;
    const path = "/" + (Array.isArray(splat) ? splat.join("/") : (splat ?? ""));
    if (!isAllowedPath(path)) {
      res.status(403).json({ error: `Path not allowed: ${path}` });
      return;
    }

    let target: URL;
    try {
      target = new URL("/api" + path, baseUrl);
    } catch {
      res.status(400).json({ error: `Invalid configured server URL: ${baseUrl}` });
      return;
    }
    for (const [key, value] of Object.entries(req.query)) {
      if (key === "env") continue; // our routing parameter, never forwarded upstream
      if (typeof value === "string") target.searchParams.set(key, value);
    }

    try {
      const upstreamRes = await fetchImpl(target, {
        headers: { Authorization: `Bearer ${env.token}` },
      });
      const body = await upstreamRes.text();
      const contentType = upstreamRes.headers.get("content-type") ?? "application/json";
      const contentDisposition = upstreamRes.headers.get("content-disposition");
      if (contentDisposition) res.setHeader("content-disposition", contentDisposition);
      res.status(upstreamRes.status).type(contentType).send(body);
    } catch (err) {
      res.status(502).json({ error: `Could not reach Technitium server: ${(err as Error).message}` });
    }
  });

  // Last, so every API path above wins over the web app's catch-all.
  if (options.staticDir) serveFrontend(app, options.staticDir);

  return app;
}
