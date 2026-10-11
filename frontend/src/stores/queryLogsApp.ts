import { defineStore } from "pinia"
import { ref } from "vue"
import { listApps, type TechnitiumCredentials, type QueryLogsApp } from "../api/technitium"

// Finds and caches which installed app actually provides query logging
// (flagged isQueryLogger: true in its dnsApps array) — Technitium ships
// four official variants (Sqlite/MySQL/PostgreSQL/SQL Server) with
// different classPaths, plus third-party loggers are possible, so this
// can't be hardcoded. Shared by ClientsView and QueryLogsView, which
// both call queryLogs()/exportLogs() and need the same app info.
export const useQueryLogsAppStore = defineStore("queryLogsApp", () => {
  const app = ref<QueryLogsApp | null>(null)
  const name = ref<string | null>(null)
  const checked = ref(false)
  const missing = ref(false)
  let checkedEnvId: number | undefined

  async function ensure(credentials: TechnitiumCredentials): Promise<void> {
    // The query-logger app is per-server, so a cached answer from one
    // environment must not be reused for another.
    const envId = credentials.envId
    if (checked.value && envId === checkedEnvId) return
    checkedEnvId = envId
    app.value = null
    name.value = null
    missing.value = false
    try {
      const res = await listApps(credentials)
      // The user may have switched servers while this was in flight; a late
      // answer for the old server must not overwrite the one for the new.
      if (envId !== checkedEnvId) return
      const match = res.response.apps.find((a) => a.dnsApps?.some((d) => d.isQueryLogger))
      const logger = match?.dnsApps?.find((d) => d.isQueryLogger)
      if (match && logger) {
        app.value = { name: match.name, classPath: logger.classPath }
        name.value = match.name
        missing.value = false
      } else {
        app.value = null
        name.value = null
        missing.value = true
      }
    } catch {
      // If the check itself fails, don't block on it — the subsequent
      // queryLogs()/exportLogs() call (if attempted) will surface its
      // own error instead.
      if (envId === checkedEnvId) missing.value = false
    } finally {
      if (envId === checkedEnvId) checked.value = true
    }
  }

  return { app, name, checked, missing, ensure }
})
