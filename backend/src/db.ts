import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";

export type UserRole = "admin" | "viewer";

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: UserRole;
  created_at: string;
}

// One Technitium server the dashboard can talk to. `token` is the server's
// API token — it is write-only: never returned by any endpoint, only ever
// stored and sent upstream with the `Authorization` header.
export interface EnvironmentRow {
  id: number;
  name: string;
  base_url: string;
  token: string;
  created_at: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS environments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL DEFAULT '',
  token TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

// The pre-1.2 schema stored one connection in a fixed `app_config` row
// (id = 1). That single row becomes the first environment, so an existing
// deployment keeps working exactly as before after the upgrade. This runs
// once and is idempotent: after it succeeds the legacy table is gone, so a
// later open finds nothing to migrate. It only ever copies the legacy row
// into a brand-new environment when there is nothing in the new table yet,
// so it can never overwrite environments an admin has since created.
function migrateLegacyAppConfig(db: Database.Database): void {
  const hasLegacy = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'app_config'")
    .get() as { name: string } | undefined;
  if (!hasLegacy) return;

  const legacy = db
    .prepare("SELECT base_url, token FROM app_config WHERE id = 1")
    .get() as { base_url: string; token: string } | undefined;
  const count = (db.prepare("SELECT COUNT(*) as n FROM environments").get() as { n: number }).n;
  if (legacy && (legacy.base_url || legacy.token) && count === 0) {
    db.prepare("INSERT INTO environments (name, base_url, token) VALUES (?, ?, ?)").run(
      "Default",
      legacy.base_url,
      legacy.token,
    );
  }
  db.exec("DROP TABLE IF EXISTS app_config");
}

export interface OpenDbOptions {
  path?: string;
  seedAdmin?: { username: string; password: string } | null;
  seedViewer?: { username: string; password: string } | null;
}

// Opens (and if needed, initializes + seeds) the app's own SQLite
// database. This is entirely separate from the Technitium DNS server —
// it only ever stores this dashboard's users, sessions, and the
// admin-managed Technitium connection(s). Nothing here is written to or
// read from the DNS server itself.
export function openDb(options: OpenDbOptions = {}): Database.Database {
  const dbPath = options.path ?? process.env.DB_PATH ?? "./data/resolvr.db";
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  migrateLegacyAppConfig(db);

  const seed = options.seedAdmin !== undefined
    ? options.seedAdmin
    : process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD
      ? { username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD }
      : null;

  // A seeded viewer is optional — most self-hosted installs just want
  // the one admin account and add viewers later from the Users page.
  // Set VIEWER_USERNAME/VIEWER_PASSWORD to also get one out of the box
  // (e.g. for demos, or a household member who should only ever see
  // the monitoring pages).
  const viewerSeed = options.seedViewer !== undefined
    ? options.seedViewer
    : process.env.VIEWER_USERNAME && process.env.VIEWER_PASSWORD
      ? { username: process.env.VIEWER_USERNAME, password: process.env.VIEWER_PASSWORD }
      : null;

  if (seed) {
    const userCount = db.prepare("SELECT COUNT(*) as n FROM users").get() as { n: number };
    if (userCount.n === 0) {
      const hash = bcrypt.hashSync(seed.password, 10);
      db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')").run(seed.username, hash);

      if (viewerSeed) {
        const viewerHash = bcrypt.hashSync(viewerSeed.password, 10);
        db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'viewer')").run(
          viewerSeed.username,
          viewerHash,
        );
      }
    }
  }

  return db;
}
