<script setup lang="ts">
import { ref } from "vue"
import { TechnitiumApiError, type DomainListResult } from "../../api/technitium"

defineOptions({ name: "ZoneTreeNode" })

const props = defineProps<{
  domain: string
  depth: number
  fetchNode: (domain: string) => Promise<DomainListResult>
}>()

const expanded = ref(false)
const loading = ref(false)
const loadError = ref<string | null>(null)
// null = not yet fetched. Fetched lazily on first expand rather than
// eagerly for the whole tree — some of these branches (e.g. "com" on
// the live server) hold 40+ entries, and most are never opened.
const children = ref<string[] | null>(null)
const hasOwnRecords = ref(false)
// Technitium's own API can auto-descend through a chain of
// single-child zones (confirmed live: expanding "example" with only
// one descendant jumped straight past it to
// "resolvr-e2e-test-domain.example", its only child, complete with
// that child's own records). response.domain is this node's real
// identity once that happens — resolvedDomain tracks it for the label.
const resolvedDomain = ref(props.domain)

async function toggle(): Promise<void> {
  expanded.value = !expanded.value
  if (!expanded.value || children.value !== null) return

  loading.value = true
  loadError.value = null
  try {
    const res = await props.fetchNode(props.domain)
    resolvedDomain.value = res.response.domain || props.domain
    hasOwnRecords.value = res.response.records.length > 0
    children.value = res.response.zones
  } catch (err) {
    loadError.value = err instanceof TechnitiumApiError ? err.message : "Could not load this branch."
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <li>
    <div class="zone-tree-row flex w-full items-center gap-1.5 rounded px-1 py-1 hover:bg-background-hover">
      <button
        type="button"
        class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        :style="{ paddingLeft: `${depth * 16}px` }"
        @click="toggle"
      >
        <svg
          v-if="loading"
          class="h-3 w-3 flex-none animate-spin text-gray-500"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
        >
          <path d="M20 11A8 8 0 1 0 18.7 16" stroke-linecap="round" />
        </svg>
        <svg
          v-else
          class="h-3 w-3 flex-none text-gray-500 transition-transform"
          :class="expanded ? 'rotate-90' : ''"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
        >
          <path d="m9 6 6 6-6 6" />
        </svg>
        <span class="truncate font-mono text-[12px] text-fg">{{ resolvedDomain }}</span>
        <span
          v-if="hasOwnRecords"
          class="flex-none rounded-md bg-crit/12 px-1.5 py-0.5 text-[10px] font-semibold text-crit"
        >
          Blocked
        </span>
      </button>
    </div>

    <p v-if="loadError" class="text-[11px] text-crit" :style="{ paddingLeft: `${(depth + 1) * 16 + 4}px` }">
      {{ loadError }}
    </p>

    <ul v-if="expanded && children && children.length > 0">
      <ZoneTreeNode
        v-for="child in children"
        :key="child"
        :domain="child"
        :depth="depth + 1"
        :fetch-node="fetchNode"
      />
    </ul>
    <p
      v-else-if="expanded && children && children.length === 0 && !hasOwnRecords && !loading"
      class="text-[11px] text-gray-500"
      :style="{ paddingLeft: `${(depth + 1) * 16 + 4}px` }"
    >
      No further entries.
    </p>
  </li>
</template>
