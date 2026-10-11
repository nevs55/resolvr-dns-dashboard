import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { openDb } from "./db.js";

let tmpFile: string | undefined;
afterEach(() => {
  if (tmpFile && fs.existsSync(tmpFile)) fs.rmSync(tmpFile);
  tmpFile = undefined;
});

describe("openDb", () => {
  it("creates an empty environments table on first open (no legacy app_config)", () => {
    const db = openDb({ path: ":memory:" });
    const rows = db.prepare("SELECT id, name, base_url, token FROM environments").all();
    expect(rows).toEqual([]);
    const legacy = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'app_config'").get();
    expect(legacy).toBeUndefined();
  });

  it("seeds an admin user when the users table is empty and seedAdmin is given", () => {
    const db = openDb({ path: ":memory:", seedAdmin: { username: "admin", password: "hunter22ab" } });

    const user = db.prepare("SELECT * FROM users WHERE username = 'admin'").get() as
      | { role: string; password_hash: string }
      | undefined;

    expect(user?.role).toBe("admin");
    expect(bcrypt.compareSync("hunter22ab", user!.password_hash)).toBe(true);
  });

  it("also seeds a viewer user when seedViewer is given alongside seedAdmin", () => {
    const db = openDb({
      path: ":memory:",
      seedAdmin: { username: "admin", password: "hunter22ab" },
      seedViewer: { username: "viewer", password: "readerpass1" },
    });

    const user = db.prepare("SELECT * FROM users WHERE username = 'viewer'").get() as
      | { role: string; password_hash: string }
      | undefined;

    expect(user?.role).toBe("viewer");
    expect(bcrypt.compareSync("readerpass1", user!.password_hash)).toBe(true);
    const count = (db.prepare("SELECT COUNT(*) as n FROM users").get() as { n: number }).n;
    expect(count).toBe(2);
  });

  it("does not seed a viewer without seedAdmin also being seeded (first-boot-only, same as admin)", () => {
    const db = openDb({ path: ":memory:", seedAdmin: null, seedViewer: { username: "viewer", password: "readerpass1" } });

    const count = (db.prepare("SELECT COUNT(*) as n FROM users").get() as { n: number }).n;
    expect(count).toBe(0);
  });

  it("does not reseed or overwrite an existing admin on a later open (container restart)", () => {
    tmpFile = path.join(os.tmpdir(), `resolvr-test-${Date.now()}.db`);
    const first = openDb({ path: tmpFile, seedAdmin: { username: "admin", password: "original-pass" } });
    first.prepare("UPDATE users SET password_hash = ? WHERE username = 'admin'").run(
      bcrypt.hashSync("changed-pass", 10),
    );
    first.close();

    const second = openDb({ path: tmpFile, seedAdmin: { username: "admin", password: "original-pass" } });
    const user = second.prepare("SELECT password_hash FROM users WHERE username = 'admin'").get() as {
      password_hash: string;
    };
    const count = (second.prepare("SELECT COUNT(*) as n FROM users").get() as { n: number }).n;

    expect(count).toBe(1);
    expect(bcrypt.compareSync("changed-pass", user.password_hash)).toBe(true);
  });
});

describe("legacy app_config migration", () => {
  function legacyDb(file: string, filled = true): void {
    const db = new Database(file);
    db.exec("CREATE TABLE app_config (id INTEGER PRIMARY KEY CHECK (id = 1), base_url TEXT NOT NULL DEFAULT '', token TEXT NOT NULL DEFAULT '');");
    db.prepare("INSERT INTO app_config (id, base_url, token) VALUES (1, ?, ?)").run(
      filled ? "http://10.0.60.60:5380" : "",
      filled ? "secret-token" : "",
    );
    db.close();
  }

  it("copies the single legacy connection into a 'Default' environment and drops the old table", () => {
    tmpFile = path.join(os.tmpdir(), `resolvr-migrate-${Date.now()}.db`);
    legacyDb(tmpFile);

    const db = openDb({ path: tmpFile });
    const envs = db.prepare("SELECT id, name, base_url, token FROM environments ORDER BY id").all() as {
      id: number;
      name: string;
      base_url: string;
      token: string;
    }[];

    expect(envs).toHaveLength(1);
    expect(envs[0]!.name).toBe("Default");
    expect(envs[0]!.base_url).toBe("http://10.0.60.60:5380");
    expect(envs[0]!.token).toBe("secret-token");
    const legacy = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'app_config'").get();
    expect(legacy).toBeUndefined();
  });

  it("is idempotent across restarts and never overwrites admin-created environments", () => {
    tmpFile = path.join(os.tmpdir(), `resolvr-migrate2-${Date.now()}.db`);
    legacyDb(tmpFile);
    const first = openDb({ path: tmpFile });
    // Simulate an admin adding a second server after the migration.
    first.prepare("INSERT INTO environments (name, base_url, token) VALUES ('Second', 'http://other:5380', 'tok2')").run();
    first.close();

    const second = openDb({ path: tmpFile });
    const envs = second.prepare("SELECT name, base_url FROM environments ORDER BY id").all() as {
      name: string;
      base_url: string;
    }[];
    expect(envs).toEqual([
      { name: "Default", base_url: "http://10.0.60.60:5380" },
      { name: "Second", base_url: "http://other:5380" },
    ]);
  });

  it("does not create an empty environment when the legacy config was never filled in", () => {
    tmpFile = path.join(os.tmpdir(), `resolvr-migrate3-${Date.now()}.db`);
    legacyDb(tmpFile, false);

    const db = openDb({ path: tmpFile });
    expect(db.prepare("SELECT COUNT(*) as n FROM environments").get()).toEqual({ n: 0 });
  });

  it("does not resurrect a deleted final environment on restart", () => {
    tmpFile = path.join(os.tmpdir(), `resolvr-migrate4-${Date.now()}.db`);
    legacyDb(tmpFile);
    const first = openDb({ path: tmpFile });
    // The admin deletes the migrated environment — the only one there is.
    first.prepare("DELETE FROM environments").run();
    first.close();

    // The legacy app_config table was dropped by the first migration, so a
    // later open must not bring the deleted environment back.
    const second = openDb({ path: tmpFile });
    expect(second.prepare("SELECT COUNT(*) as n FROM environments").get()).toEqual({ n: 0 });
  });
});
