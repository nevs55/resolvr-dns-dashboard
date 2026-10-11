<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue"
import { exportBlockedZones, listBlockedZones, TechnitiumApiError } from "../../api/technitium"
import { useConnectionStore } from "../../stores/connection"
import { useRefreshStore } from "../../stores/refresh"
import { triggerDownload } from "../../lib/download"
import { cached } from "../../lib/charts"
import { walkBlockedZones, type WalkResult } from "../../lib/blockedTree"
import ZoneTreeNode from "../zones/ZoneTreeNode.vue"

const props = defineProps<{ highlightDomain: string | null }>()

const connection = useConnectionStore()
const refresh = useRefreshStore()

const CACHE_KEY = "blocked-walk"
const TTL_MS = 60_000

const domains = ref<string[]>([])
const state = ref<"loading" | "ready" | "error">("loading")
const found = ref(0)
const truncated = ref(false)
const loadError = ref<string | null>(null)
const actionError = ref<string | null>(null)

const fetchNode = (d: string) => listBlockedZones(connection.credentials, d)

async function load(force = false): Promise<void> {
  if (!connection.isConfigured) return
  state.value = "loading"
  found.value = 0
  try {
    const res = await cached<WalkResult>(
      CACHE_KEY,
      TTL_MS,
      () => walkBlockedZones(fetchNode, { onProgress: (n) => (found.value = n) }),
      force,
    )
    domains.value = res.domains
    truncated.value = res.truncated
    state.value = "ready"
  } catch (err) {
    loadError.value = err instanceof TechnitiumApiError ? err.message : "Could not load your blocked domains."
    state.value = "error"
  }
}

onMounted(() => void load())
watch(() => refresh.tick, () => void load(true))
watch(() => connection.isConfigured, (c) => c && void load())

// Bring a highlighted domain (one a check matched) into view once listed.
watch(
  [() => state.value, () => props.highlightDomain],
  async ([s, d]) => {
    if (s !== "ready" || !d) return
    await nextTick()
    document.querySelector(".blocked-row.bg-accent\\/15")?.scrollIntoView?.({ behavior: "smooth", block: "center" })
  },
  { immediate: true },
)

// ---------- the list ----------

const filterText = ref("")
const visible = computed(() => {
  const q = filterText.value.trim().toLowerCase()
  return q ? domains.value.filter((d) => d.includes(q)) : domains.value
})

// ---------- export and tree ----------

async function onExport(): Promise<void> {
  try {
    triggerDownload(await exportBlockedZones(connection.credentials))
  } catch (err) {
    actionError.value = err instanceof TechnitiumApiError ? err.message : "Could not export blocked zones."
  }
}

const treeOpen = ref(false)
const roots = ref<string[] | null>(null)
const treeError = ref<string | null>(null)

async function onTreeToggle(e: Event): Promise<void> {
  treeOpen.value = (e.target as HTMLDetailsElement).open
  if (!treeOpen.value || roots.value) return
  try {
    const res = await fetchNode("")
    roots.value = res.response.zones.length ? res.response.zones : [...new Set(res.response.records.map((r) => r.name))]
  } catch (err) {
    treeError.value = err instanceof TechnitiumApiError ? err.message : "Could not load the tree."
  }
}
</script>

<template>
  <section class="rounded-lg border border-border bg-background-card p-4" aria-label="Your blocked domains">
    <h2 class="text-sm font-semibold">Your blocked domains</h2>
    <p class="mb-3 mt-0.5 text-xs text-gray-500">Domains you block yourself, on top of the feeds. This page is read-only — manage them in Technitium's own admin console.</p>

    <p v-if="actionError" id="blocked-action-error" class="mt-2 text-sm text-crit">{{ actionError }}</p>

    <div class="mt-3 flex flex-wrap items-center gap-2">
      <input
        id="blocked-filter"
        v-model="filterText"
        type="search"
        placeholder="Filter your blocked domains"
        aria-label="Filter blocked domains"
        class="min-w-0 flex-[1_1_200px] rounded-md border border-border-hover bg-background-card px-2.5 py-1 text-[13px]"
      />
      <span id="blocked-count" class="text-xs tabular-nums text-gray-500">{{ visible.length }} of {{ domains.length }}</span>
      <button id="export-blocked" type="button" class="rounded-md border border-border-hover px-3 py-1 text-[13px]" @click="onExport">Export</button>
    </div>

    <p v-if="state === 'loading'" id="blocked-loading" class="mt-3 text-sm text-gray-500">Loading your blocked domains… {{ found }} found so far.</p>
    <p v-else-if="state === 'error'" id="blocked-error" class="mt-3 text-sm text-crit">{{ loadError }}</p>
    <template v-else>
      <p v-if="truncated" id="blocked-truncated" class="mt-2 text-xs text-warn">The list is very large, so only the first part is shown. Use the tree below to browse the rest.</p>
      <p v-if="visible.length === 0" class="mt-3 text-sm text-gray-500">{{ domains.length === 0 ? "You have not blocked any domains yet." : "No domains match." }}</p>
      <ul v-else id="blocked-domain-list" class="mt-2.5 flex flex-col">
        <li
          v-for="d in visible"
          :key="d"
          class="blocked-row flex items-center justify-between gap-2.5 border-t border-border/60 px-1 py-1.5"
          :class="d === highlightDomain ? 'bg-accent/15' : ''"
        >
          <span class="break-all font-mono text-[13px]">{{ d }}</span>
        </li>
      </ul>
    </template>

    <details class="mt-3.5 border-t border-border pt-2.5" @toggle="onTreeToggle">
      <summary class="cursor-pointer text-[13px] font-semibold">Browse as a tree</summary>
      <p v-if="treeError" class="mt-2 text-sm text-crit">{{ treeError }}</p>
      <ul v-else-if="roots" id="blocked-zone-tree" class="mt-2">
        <ZoneTreeNode v-for="d in roots" :key="d" :domain="d" :depth="0" :fetch-node="fetchNode" />
      </ul>
      <p v-else-if="treeOpen" class="mt-2 text-sm text-gray-500">Loading…</p>
    </details>
  </section>
</template>
