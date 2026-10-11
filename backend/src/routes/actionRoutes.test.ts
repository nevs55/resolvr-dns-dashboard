import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { openDb } from "../db.js";
import { actionRoutes } from "./actionRoutes.js";

// Every URL the old mutating implementation used to expose. Read-only mode
// must deny each one — even when a server IS configured — and must never
// make an upstream call.
const LEGACY_ACTIONS = [
  "/flush-cache",
  "/update-block-lists",
  "/block-list-urls",
  "/block-domain",
  "/unblock-domain",
  "/uninstall-app",
  "/create-zone",
  "/add-record",
  "/delete-zone",
  "/revoke-session",
] as const;

const METHODS = ["post", "put", "get", "delete"] as const;

function testApp(fetchImpl: typeof fetch) {
  const db = openDb({ path: ":memory:" });
  // A configured server proves denial is not because config is missing.
  db.prepare("INSERT INTO environments (name, base_url, token) VALUES ('Default', ?, ?)").run(
    "http://10.0.60.60:5380",
    "secret-token",
  );
  const app = express();
  app.use(express.json());
  app.use("/api/actions", actionRoutes());
  return { app, db };
}

describe("actionRoutes (read-only mode)", () => {
  it("rejects every legacy mutating action URL with 403, never calling upstream", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const { app } = testApp(fetchImpl);

    for (const action of LEGACY_ACTIONS) {
      const res = await request(app).post(`/api/actions${action}`);
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/read-only/i);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects any HTTP method, not just POST", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const { app } = testApp(fetchImpl);

    for (const method of METHODS) {
      const res = await request(app)[method]("/api/actions/flush-cache");
      expect(res.status).toBe(403);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an unknown action path too, so nothing can slip through the deny-all", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const { app } = testApp(fetchImpl);

    const res = await request(app).post("/api/actions/something-else");

    expect(res.status).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("denies even when a server is configured with a token", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const { app } = testApp(fetchImpl);

    const res = await request(app)
      .post("/api/actions/flush-cache")
      .send({});

    expect(res.status).toBe(403);
    // The token is present and valid-looking; the point is it must never
    // be used to reach the server.
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
