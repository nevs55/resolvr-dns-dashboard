import { describe, it, expect, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { openDb } from "../db.js";
import { environmentsRoutes, statusRoute, overviewRoute } from "./configRoutes.js";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function pingOk() {
  return jsonResponse({ status: "ok", info: { dnsServerDomain: "dns.villa58.lan", version: "15.4" } });
}

// Mounts the environments router with a fake auth layer so the admin gating
// can be exercised without spinning up the full app/login flow.
function envApp(fetchImpl: typeof fetch, role: "admin" | "viewer" = "admin") {
  const db = openDb({ path: ":memory:" });
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user: { role: string } }).user = { role };
    next();
  });
  app.use("/api/environments", environmentsRoutes(db, { fetchImpl }));
  return { app, db };
}

function statusApp(fetchImpl: typeof fetch) {
  const db = openDb({ path: ":memory:" });
  const app = express();
  app.get("/api/status", statusRoute(db, { fetchImpl }));
  return { app, db };
}

function overviewApp(fetchImpl: typeof fetch) {
  const db = openDb({ path: ":memory:" });
  const app = express();
  app.get("/api/overview", overviewRoute(db, { fetchImpl }));
  return { app, db };
}

function insertEnv(db: ReturnType<typeof openDb>, name: string, baseUrl: string, token: string): number {
  const info = db.prepare("INSERT INTO environments (name, base_url, token) VALUES (?, ?, ?)").run(name, baseUrl, token);
  return Number(info.lastInsertRowid);
}

describe("environmentsRoutes", () => {
  it("lists environments without ever exposing a token", async () => {
    const db = openDb({ path: ":memory:" });
    insertEnv(db, "Home", "http://10.0.60.60:5380", "super-secret");
    const app = express();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as Request & { user: { role: string } }).user = { role: "admin" };
      next();
    });
    app.use("/api/environments", environmentsRoutes(db, { fetchImpl: vi.fn() }));

    const res = await request(app).get("/api/environments");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      managed: false,
      environments: [{ id: 1, name: "Home", baseUrl: "http://10.0.60.60:5380" }],
    });
    expect(JSON.stringify(res.body)).not.toContain("super-secret");
  });

  it("validates against the real server before persisting a new environment", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => pingOk());
    const { app, db } = envApp(fetchImpl);

    const res = await request(app)
      .post("/api/environments")
      .send({ name: "Home", baseUrl: "http://10.0.60.60:5380", token: "secret" });

    expect(res.status).toBe(200);
    expect(res.body.environment).toEqual({ id: 1, name: "Home", baseUrl: "http://10.0.60.60:5380" });
    expect(res.body).toMatchObject({ serverDomain: "dns.villa58.lan", serverVersion: "15.4" });
    const stored = db.prepare("SELECT base_url, token FROM environments WHERE id = 1").get();
    expect(stored).toEqual({ base_url: "http://10.0.60.60:5380", token: "secret" });
    expect(JSON.stringify(res.body)).not.toContain("secret");
  });

  it("rejects and does not persist an invalid token", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ status: "invalid-token", errorMessage: "Invalid token or session expired." }));
    const { app, db } = envApp(fetchImpl);

    const res = await request(app).post("/api/environments").send({ name: "Home", baseUrl: "http://10.0.60.60:5380", token: "bad" });

    expect(res.status).toBe(400);
    expect(db.prepare("SELECT COUNT(*) as n FROM environments").get()).toEqual({ n: 0 });
  });

  it("rejects a non-http(s) base URL before persisting", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const { app, db } = envApp(fetchImpl);

    const res = await request(app)
      .post("/api/environments")
      .send({ name: "Home", baseUrl: "ftp://10.0.60.60:5380", token: "secret" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("http://");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(db.prepare("SELECT COUNT(*) as n FROM environments").get()).toEqual({ n: 0 });
  });

  it("updates a name or URL without requiring the token to be re-entered", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => pingOk());
    const { app, db } = envApp(fetchImpl);
    insertEnv(db, "Home", "http://10.0.60.60:5380", "keep-me");

    const res = await request(app).put("/api/environments/1").send({ name: "Renamed" });

    expect(res.status).toBe(200);
    expect(res.body.environment).toEqual({ id: 1, name: "Renamed", baseUrl: "http://10.0.60.60:5380" });
    // The token is preserved even though the caller never sent it back.
    expect(db.prepare("SELECT token FROM environments WHERE id = 1").get()).toEqual({ token: "keep-me" });
  });

  it("rotates the token only when a new one is supplied", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => pingOk());
    const { app, db } = envApp(fetchImpl);
    insertEnv(db, "Home", "http://10.0.60.60:5380", "old-token");

    await request(app).put("/api/environments/1").send({ token: "new-token" });

    expect(db.prepare("SELECT token FROM environments WHERE id = 1").get()).toEqual({ token: "new-token" });
  });

  it("deletes an environment", async () => {
    const { app, db } = envApp(vi.fn());
    insertEnv(db, "Home", "http://10.0.60.60:5380", "secret");

    const res = await request(app).delete("/api/environments/1");

    expect(res.status).toBe(200);
    expect(db.prepare("SELECT COUNT(*) as n FROM environments").get()).toEqual({ n: 0 });
  });

  it("a viewer can list but cannot create, update, or delete environments", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => pingOk());
    const { app, db } = envApp(fetchImpl, "viewer");
    insertEnv(db, "Home", "http://10.0.60.60:5380", "secret");

    expect((await request(app).get("/api/environments")).status).toBe(200);
    expect((await request(app).post("/api/environments").send({ name: "X", baseUrl: "http://x", token: "t" })).status).toBe(403);
    expect((await request(app).put("/api/environments/1").send({ name: "X" })).status).toBe(403);
    expect((await request(app).delete("/api/environments/1")).status).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(db.prepare("SELECT COUNT(*) as n FROM environments").get()).toEqual({ n: 1 });
  });

  it("refuses all mutations when the connection is add-on managed", async () => {
    const db = openDb({ path: ":memory:" });
    insertEnv(db, "Default", "http://10.0.60.60:5380", "secret");
    const app = express();
    app.use(express.json());
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as Request & { user: { role: string } }).user = { role: "admin" };
      next();
    });
    app.use("/api/environments", environmentsRoutes(db, { fetchImpl: vi.fn(), managed: true }));

    expect((await request(app).post("/api/environments").send({ name: "X", baseUrl: "http://x", token: "t" })).status).toBe(409);
    expect((await request(app).put("/api/environments/1").send({ name: "X" })).status).toBe(409);
    expect((await request(app).delete("/api/environments/1")).status).toBe(409);
    expect((await request(app).get("/api/environments")).body.managed).toBe(true);
    expect((await request(app).get("/api/environments")).body.environments[0].name).toBe("Default");
  });
});

describe("statusRoute", () => {
  it("reports unconfigured status when nothing has been saved yet", async () => {
    const { app } = statusApp(vi.fn());
    const res = await request(app).get("/api/status");
    expect(res.body).toEqual({ configured: false, connected: false, serverDomain: null, serverVersion: null });
  });

  it("reports connected status for the single environment once configured (single-server compat)", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => pingOk());
    const { app, db } = statusApp(fetchImpl);
    insertEnv(db, "Home", "http://10.0.60.60:5380", "secret");

    const res = await request(app).get("/api/status");

    expect(res.body).toEqual({
      configured: true,
      connected: true,
      serverDomain: "dns.villa58.lan",
      serverVersion: "15.4",
      error: null,
    });
  });

  it("reports status for a specific environment by id", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => pingOk());
    const { app, db } = statusApp(fetchImpl);
    insertEnv(db, "Home", "http://10.0.60.60:5380", "secret");
    insertEnv(db, "Office", "http://10.0.70.70:5380", "other");

    const res = await request(app).get("/api/status").query({ env: "2" });

    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
    const [calledUrl] = fetchImpl.mock.calls[0]!;
    expect(String(calledUrl)).toContain("10.0.70.70:5380");
  });

  it("returns 400 when multiple environments exist and none is specified", async () => {
    const { app, db } = statusApp(vi.fn());
    insertEnv(db, "Home", "http://10.0.60.60:5380", "secret");
    insertEnv(db, "Office", "http://10.0.70.70:5380", "other");

    const res = await request(app).get("/api/status");

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Multiple servers");
  });
});

describe("overviewRoute (global overview)", () => {
  it("reports per-server health and blocked stats with a common time window", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/user/session/get")) return pingOk();
      return jsonResponse({ status: "ok", response: { stats: { totalQueries: 5133, totalBlocked: 120 } } });
    });
    const { app, db } = overviewApp(fetchImpl as unknown as typeof fetch);
    insertEnv(db, "Home", "http://10.0.60.60:5380", "secret");
    insertEnv(db, "Office", "http://10.0.70.70:5380", "other");

    const res = await request(app).get("/api/overview");

    expect(res.status).toBe(200);
    expect(res.body.window).toBe("LastHour");
    expect(res.body.environments).toHaveLength(2);
    expect(res.body.environments[0]).toMatchObject({
      id: 1,
      name: "Home",
      connected: true,
      serverDomain: "dns.villa58.lan",
      totalQueries: 5133,
      totalBlocked: 120,
      error: null,
    });
    // The stats call is issued for every server with the same window type.
    const statsCalls = fetchImpl.mock.calls.filter(([u]) => String(u).includes("/dashboard/stats/get"));
    expect(statsCalls).toHaveLength(2);
    for (const [u] of statsCalls) {
      expect(new URL(String(u)).searchParams.get("type")).toBe("LastHour");
    }
  });

  it("degrades only the failing server and never fabricates a zero total", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("10.0.70.70")) throw new Error("connect ECONNREFUSED");
      if (url.includes("/user/session/get")) return pingOk();
      return jsonResponse({ status: "ok", response: { stats: { totalQueries: 42, totalBlocked: 3 } } });
    });
    const { app, db } = overviewApp(fetchImpl as unknown as typeof fetch);
    insertEnv(db, "Home", "http://10.0.60.60:5380", "secret");
    insertEnv(db, "Office", "http://10.0.70.70:5380", "other");

    const res = await request(app).get("/api/overview");

    expect(res.status).toBe(200);
    const [home, office] = res.body.environments;
    expect(home.connected).toBe(true);
    expect(home.totalQueries).toBe(42);
    expect(office.connected).toBe(false);
    // The down server reports null, not 0 — no misleading totals.
    expect(office.totalQueries).toBeNull();
    expect(office.totalBlocked).toBeNull();
    expect(office.error).toContain("ECONNREFUSED");
  });
});
