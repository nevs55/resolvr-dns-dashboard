// The environment a request targets, as a module-level value. It is set by
// the connection store whenever the user switches environments and read by
// the API clients (api/technitium.ts and api/app.ts) so every request is
// tagged with the right `env`. This is deliberately per-tab in-memory state
// (plus the store's own sessionStorage persistence) — there is no global
// server selection shared between users or tabs.

let activeId: number | undefined

export function getActiveEnvironmentId(): number | undefined {
  return activeId
}

export function setActiveEnvironmentId(id: number | undefined): void {
  activeId = id
}

// Scopes a localStorage key to the active environment, so browser-local
// histories (known clients, block-list history, cache samples, remembered
// tabs) never leak from one server to another. Unscoped when no environment
// is active, which keeps existing single-server behavior byte-for-byte.
export function envScopedKey(base: string): string {
  const id = getActiveEnvironmentId()
  return id === undefined ? base : `env.${id}.${base}`
}
