import type { RouteLocationRaw } from "vue-router"
import { getActiveEnvironmentId } from "./activeEnv"

// Builds a location for a scoped route pointing at the active environment.
// Used by chart/row click-throughs (e.g. "open in Query Logs") so they land
// on the same server the user is already looking at, not a hardcoded one.
export function envRoute(name: string, query: Record<string, string> = {}): RouteLocationRaw {
  return { name, params: { envId: String(getActiveEnvironmentId()) }, query }
}
