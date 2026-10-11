import { defineStore } from "pinia"
import { ref, computed } from "vue"
import {
  getStatus,
  listEnvironments,
  createEnvironment as apiCreateEnvironment,
  updateEnvironment as apiUpdateEnvironment,
  deleteEnvironment as apiDeleteEnvironment,
  AppApiError,
  type EnvironmentSummary,
} from "../api/app"
import type { TechnitiumCredentials } from "../api/technitium"
import { setActiveEnvironmentId } from "../lib/activeEnv"

export type ConnectionStatus = "idle" | "testing" | "connected" | "error"

const ACTIVE_ENV_KEY = "resolvr.activeEnv"

// The active environment is a per-tab choice, never a server-side global:
// each tab remembers its own selection in sessionStorage, so two tabs (or
// two browsers) can look at different servers at once. sessionStorage is
// the right storage here — it is scoped to the tab and cleared when the
// tab closes, whereas localStorage would let one forgotten tab pin a server
// for every other tab on the same origin. The list of environments itself
// is admin-managed in the backend (see /api/environments) and shared
// read-only with every signed-in role.
export const useConnectionStore = defineStore("connection", () => {
  const environments = ref<EnvironmentSummary[]>([])
  const managed = ref(false)
  const activeEnvId = ref<number | undefined>(undefined)

  // Per-active-environment connectivity, same shape as the old single-server
  // store so every view that reads it keeps working unchanged.
  const status = ref<ConnectionStatus>("idle")
  const error = ref<string | null>(null)
  const serverDomain = ref<string | null>(null)
  const serverVersion = ref<string | null>(null)
  const isConfigured = ref(false)

  function readStoredEnvId(): number | undefined {
    try {
      const v = sessionStorage.getItem(ACTIVE_ENV_KEY)
      return v === null ? undefined : Number(v)
    } catch {
      return undefined
    }
  }

  function persistEnvId(id: number | undefined): void {
    try {
      if (id === undefined) sessionStorage.removeItem(ACTIVE_ENV_KEY)
      else sessionStorage.setItem(ACTIVE_ENV_KEY, String(id))
    } catch {
      // Private mode / blocked storage: the selection still works for this tab.
    }
  }

  // Kept so the ~30 views that pass `connection.credentials` into API calls
  // don't need to change. baseUrl/token are no longer used anywhere (auth
  // moved to the session cookie; the backend picks the server from `envId`),
  // but the env id rides along so cache-scoping (see lib/charts.ts,
  // stores/queryLogsApp.ts) can tell environments apart.
  const credentials = computed<TechnitiumCredentials>(() => ({
    baseUrl: "",
    token: "",
    envId: activeEnvId.value,
  }))

  function applyStatus(s: { configured: boolean; connected: boolean; serverDomain: string | null; serverVersion: string | null; error?: string | null }): void {
    isConfigured.value = s.configured
    serverDomain.value = s.serverDomain
    serverVersion.value = s.serverVersion
    if (!s.configured) {
      status.value = "idle"
      error.value = null
    } else if (s.connected) {
      status.value = "connected"
      error.value = null
    } else {
      status.value = "error"
      error.value = s.error ?? "Could not connect to the configured Technitium server."
    }
  }

  async function testConnection(envId: number | undefined = activeEnvId.value): Promise<void> {
    status.value = "testing"
    try {
      const s = await getStatus(envId)
      // The user may have switched environments while this request was in
      // flight; a late response for the old server must not overwrite the
      // status of the one they're looking at now.
      if (envId !== activeEnvId.value) return
      applyStatus(s)
    } catch (err) {
      if (envId !== activeEnvId.value) return
      status.value = "error"
      error.value = err instanceof AppApiError ? err.message : "Could not reach the backend."
    }
  }

  // Loads the environment list and restores the active selection (last-used
  // in this browser, else the first environment). Call once on app boot and
  // after any create/update/delete.
  async function loadEnvironments(): Promise<void> {
    try {
      const res = await listEnvironments()
      environments.value = res.environments
      managed.value = res.managed
      const stored = readStoredEnvId()
      const valid = environments.value.some((e) => e.id === stored)
      const next = valid ? stored : environments.value[0]?.id
      activeEnvId.value = next
      persistEnvId(next)
      setActiveEnvironmentId(next)
      if (next !== undefined) {
        await testConnection(next)
      } else {
        status.value = "idle"
        isConfigured.value = false
        serverDomain.value = null
        serverVersion.value = null
        error.value = null
      }
    } catch {
      // The list couldn't load — leave whatever state we had; views show
      // their own unconfigured state.
    }
  }

  // Switching environments re-targets every subsequent API call (via
  // lib/activeEnv.ts) and, because AppShell keys its <router-view> by
  // activeEnvId, remounts the current page so in-flight responses for the
  // old server can't write stale data into the new one.
  async function selectEnvironment(id: number): Promise<void> {
    if (id === activeEnvId.value) return
    activeEnvId.value = id
    persistEnvId(id)
    setActiveEnvironmentId(id)
    await testConnection(id)
  }

  async function createEnv(name: string, baseUrl: string, token: string): Promise<void> {
    await apiCreateEnvironment(name, baseUrl, token)
    await loadEnvironments()
  }

  async function updateEnv(id: number, fields: { name?: string; baseUrl?: string; token?: string }): Promise<void> {
    await apiUpdateEnvironment(id, fields)
    await loadEnvironments()
  }

  async function deleteEnv(id: number): Promise<void> {
    await apiDeleteEnvironment(id)
    await loadEnvironments()
  }

  function reset(): void {
    environments.value = []
    managed.value = false
    activeEnvId.value = undefined
    setActiveEnvironmentId(undefined)
    status.value = "idle"
    error.value = null
    serverDomain.value = null
    serverVersion.value = null
    isConfigured.value = false
  }

  return {
    environments,
    managed,
    activeEnvId,
    status,
    error,
    serverDomain,
    serverVersion,
    isConfigured,
    credentials,
    loadEnvironments,
    selectEnvironment,
    testConnection,
    createEnv,
    updateEnv,
    deleteEnv,
    reset,
  }
})
