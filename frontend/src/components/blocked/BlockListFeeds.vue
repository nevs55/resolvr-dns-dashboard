<script setup lang="ts">
import { computed } from "vue"
import { parseFeedLines } from "../../lib/blockLists"

const props = defineProps<{
  // The feed list as the server holds it: "# heading" lines and URLs.
  lines: string[]
  // A feed to point out, e.g. the one a domain check matched.
  highlightUrl: string | null
}>()

const groups = computed(() => parseFeedLines(props.lines))

function liveCount(feeds: { url: string }[]): string {
  if (feeds.length === 0) return "Divider"
  return feeds.length === 1 ? "1 feed" : `${feeds.length} feeds`
}
</script>

<template>
  <section class="rounded-lg border border-border bg-background-card p-4" aria-label="Block list feeds">
    <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
      <div>
        <h2 class="text-sm font-semibold">Feeds</h2>
        <p class="mt-0.5 text-xs text-gray-500">The lists your server downloads and merges. This page is read-only — edit them in Technitium's own admin console.</p>
      </div>
    </div>

    <p v-if="groups.length === 0" id="feeds-empty" class="mt-3 text-sm text-gray-500">No feeds configured.</p>
    <div v-for="g in groups" :key="g.id" class="feed-group mt-2.5 overflow-hidden rounded-lg border border-border">
      <div class="flex items-center gap-2 bg-background-hover px-2.5 py-1.5">
        <span class="group-name min-w-0 flex-1 truncate px-1.5 py-0.5 text-[12.5px] font-bold uppercase tracking-wide text-gray-300">
          {{ g.name || "Ungrouped" }}
        </span>
        <span class="group-count text-xs text-gray-500">{{ liveCount(g.feeds) }}</span>
      </div>
      <div
        v-for="f in g.feeds"
        :key="f.url"
        class="feed-row grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-t border-border/60 px-2.5 py-1.5"
        :class="f.url === highlightUrl ? 'bg-accent/15' : ''"
        :data-highlight="f.url === highlightUrl"
      >
        <a :href="f.url" target="_blank" rel="noopener noreferrer" class="break-all font-mono text-[12.5px] hover:text-accent hover:underline">{{ f.url }}</a>
        <span v-if="f.url === highlightUrl" class="ml-1.5 rounded border border-accent px-1 font-sans text-[10px] font-bold uppercase text-accent">Matched</span>
      </div>
    </div>
  </section>
</template>
