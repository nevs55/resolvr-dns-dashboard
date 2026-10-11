<script setup lang="ts">
import { ref, onMounted } from "vue"
import { useRouter } from "vue-router"
import { getOverview, type OverviewServer, AppApiError } from "../../api/app"
import { useAuthStore } from "../../stores/auth"

const router = useRouter()
const auth = useAuthStore()

const loading = ref(true)
const error = ref<string | null>(null)
const servers = ref<OverviewServer[]>([])
const window = ref<string>("LastHour")

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const res = await getOverview()
    servers.value = res.environments
    window.value = res.window
  } catch (err) {
    error.value = err instanceof AppApiError ? err.message : "Could not reach the backend."
  } finally {
    loading.value = false
  }
}

function open(id: number): void {
  void router.push({ name: "overview", params: { envId: String(id) } })
}

onMounted(load)
</script>

<template>
  <main class="px-1 py-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">All Servers</h1>
        <p class="mt-1 text-sm text-gray-500">
          Health, version and blocked queries for every Technitium server — one snapshot, same time window.
        </p>
      </div>
      <div class="flex items-center gap-2">
        <button
          id="overview-refresh"
          type="button"
          :disabled="loading"
          class="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-gray-500 hover:bg-background-hover hover:text-fg disabled:opacity-50"
          @click="load"
        >
          Refresh
        </button>
        <router-link
          v-if="auth.isAdmin"
          to="/connect"
          class="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white"
        >
          Manage servers
        </router-link>
      </div>
    </div>

    <p v-if="loading" class="mt-8 text-sm text-gray-500">Loading…</p>
    <p v-else-if="error" id="overview-error" class="mt-8 text-sm text-crit">{{ error }}</p>

    <div v-else-if="servers.length === 0" class="mt-8 rounded-lg border border-border bg-background-card px-4 py-8 text-center text-sm text-gray-500">
      No Technitium servers are configured yet.
      <router-link v-if="auth.isAdmin" to="/connect" class="font-semibold text-accent">Add your first server</router-link>.
    </div>

    <ul v-else id="server-list" class="mt-6 flex flex-col gap-3">
      <li v-for="server in servers" :key="server.id">
        <button
          type="button"
          class="w-full rounded-lg border border-border bg-background-card px-4 py-3 text-left transition-colors hover:border-border-hover"
          @click="open(server.id)"
        >
          <div class="flex items-center gap-2">
            <span
              class="h-2 w-2 flex-none rounded-full"
              :class="server.connected ? 'bg-ok' : 'bg-crit'"
            />
            <span class="text-sm font-semibold">{{ server.name }}</span>
            <span class="truncate font-mono text-xs text-gray-500">{{ server.serverDomain }}</span>
            <span v-if="server.serverVersion" class="ml-auto font-mono text-xs text-gray-500">v{{ server.serverVersion }}</span>
          </div>
          <div class="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-gray-500">
            <span v-if="server.connected && server.totalQueries !== null">
              <b class="text-fg">{{ server.totalQueries.toLocaleString("en-US") }}</b> queries
            </span>
            <span v-if="server.connected && server.totalBlocked !== null">
              <b class="text-fg">{{ server.totalBlocked.toLocaleString("en-US") }}</b> blocked
            </span>
            <span v-if="server.totalQueries === null && server.totalBlocked === null" class="text-gray-400">
              Statistics unavailable
            </span>
            <span v-if="server.error" class="text-crit">{{ server.error }}</span>
          </div>
        </button>
      </li>
    </ul>
  </main>
</template>
