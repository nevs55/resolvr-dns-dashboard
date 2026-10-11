import { describe, it, expect } from "vitest";
import { ALLOWED_PATHS, isAllowedPath } from "./proxyAllowlist.js";
import { ENDPOINTS } from "./endpoints.js";

// Every Technitium endpoint the old mutating action routes called. None of
// them may appear on the GET proxy's allowlist — the proxy forwards query
// params verbatim, so its allowlist is the only thing standing between a
// client and the DNS server, and read-only means *none* of these may pass.
const MUTATING_PATHS = [
  "/cache/flush",
  "/settings/forceUpdateBlockLists",
  "/settings/set",
  "/blocked/add",
  "/blocked/delete",
  "/apps/uninstall",
  "/zones/create",
  "/zones/records/add",
  "/zones/delete",
  "/admin/sessions/delete",
];

describe("proxyAllowlist", () => {
  it("allows every path defined in the endpoints registry", () => {
    for (const path of Object.values(ENDPOINTS)) {
      expect(isAllowedPath(path)).toBe(true);
    }
  });

  it("contains exactly the endpoints registry's paths, nothing more", () => {
    expect(ALLOWED_PATHS.size).toBe(Object.keys(ENDPOINTS).length);
  });

  it("still rejects a path not in the registry", () => {
    expect(isAllowedPath("/zones/delete")).toBe(false);
  });

  it("rejects every Technitium mutating endpoint", () => {
    for (const path of MUTATING_PATHS) {
      expect(isAllowedPath(path)).toBe(false);
    }
  });

  it("contains no mutating path, i.e. every allowed path is a read", () => {
    // Defense against someone adding a write endpoint to ENDPOINTS by
    // mistake: none of the allowed paths may be a known mutator.
    for (const path of ALLOWED_PATHS) {
      expect(MUTATING_PATHS).not.toContain(path);
    }
  });
});
