import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { mount, flushPromises } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"
import { createRouter, createMemoryHistory } from "vue-router"

vi.mock("../../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../../api/technitium")>("../../api/technitium")
  return { ...actual, listBlockedZones: vi.fn(), exportBlockedZones: vi.fn(), getSettings: vi.fn(), getDashboardStats: vi.fn(), resolveDnsQuery: vi.fn() }
})
vi.mock("../../lib/download", () => ({ triggerDownload: vi.fn() }))

import { listBlockedZones, exportBlockedZones, getSettings, getDashboardStats, resolveDnsQuery, TechnitiumApiError } from "../../api/technitium"
import { triggerDownload } from "../../lib/download"
import { clearCache } from "../../lib/charts"
import { useConnectionStore } from "../../stores/connection"
import { useRefreshStore } from "../../stores/refresh"
import BlockedZonesView from "./BlockedZonesView.vue"

const HOUR = 3600_000
// Fixed per test, so "the next update has not moved" is really the same string.
let NEXT = ""
const LINES = ["# General threat intel", "https://a.example.com/t.txt", "# Ads and trackers", "https://b.example.org/ads.txt"]

function settings(over: Record<string, unknown> = {}) {
  return {
    response: {
      enableBlocking: true,
      blockingType: "NxDomain",
      blockListUrls: LINES,
      blockListUpdateIntervalHours: 12,
      blockListNextUpdatedOn: NEXT,
      ...over,
    },
  } as never
}

const statsWith = (n: number) => ({ response: { stats: { blockListZones: n } } }) as never

// com -> example.com (blocked); net -> ads.example.net (blocked)
const TREE: Record<string, { zones: string[]; own: boolean }> = {
  "": { zones: ["com", "net"], own: false },
  com: { zones: ["example.com"], own: false },
  "example.com": { zones: [], own: true },
  net: { zones: ["ads.example.net"], own: false },
  "ads.example.net": { zones: [], own: true },
}

function mockServer() {
  vi.mocked(getSettings).mockResolvedValue(settings())
  vi.mocked(getDashboardStats).mockResolvedValue(statsWith(1203411))
  vi.mocked(listBlockedZones).mockImplementation((async (_c: unknown, d = "") => {
    const n = TREE[d as string]!
    return { response: { domain: d, zones: n.zones, records: n.own ? [{ name: d, type: "A", ttl: 1, rData: {} }] : [] } }
  }) as never)
}

async function makeRouter(path = "/blocked") {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/blocked", component: BlockedZonesView },
      { path: "/connect", component: { template: "<div />" } },
    ],
  })
  await router.push(path)
  return router
}

async function mountPage(tab?: "feeds" | "domains" | "check") {
  const router = await makeRouter(tab ? `/blocked?tab=${tab}` : "/blocked")
  const wrapper = mount(BlockedZonesView, { global: { plugins: [router] }, attachTo: document.body })
  useConnectionStore().isConfigured = true
  await flushPromises()
  return wrapper
}

describe("BlockedZonesView", () => {
  beforeEach(() => {
    NEXT = new Date(Date.now() + 4 * HOUR).toISOString()
    clearCache()
    localStorage.clear()
    setActivePinia(createPinia())
    for (const f of [listBlockedZones, exportBlockedZones, getSettings, getDashboardStats, resolveDnsQuery, triggerDownload]) {
      ;(f as unknown as { mockReset: () => void }).mockReset()
    }
    mockServer()
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ""
  })

  it("prompts to connect when no server is configured", async () => {
    const wrapper = mount(BlockedZonesView, { global: { plugins: [await makeRouter()], stubs: { RouterLink: true } } })
    await flushPromises()
    expect(wrapper.text()).toContain("Connect to a Technitium server")
    expect(getSettings).not.toHaveBeenCalled()
  })

  describe("tabs", () => {
    it("keeps the status card on top and opens on Feeds", async () => {
      const w = await mountPage()
      expect(w.findAll('[role="tab"]').map((t) => t.text())).toEqual(["Feeds", "Your domains", "Check a domain"])
      expect(w.get("#blocked-tab-feeds").attributes("aria-selected")).toBe("true")
      expect(w.find("#status-total").exists()).toBe(true)
      expect(w.find(".feed-row").exists()).toBe(true)
      expect(w.find("#blocked-filter").exists()).toBe(false)
      expect(w.find("#check-domain").exists()).toBe(false)
    })

    it("shows only the chosen section, records it in the URL, and keeps the status card", async () => {
      const w = await mountPage()
      await w.get("#blocked-tab-domains").trigger("click")
      await flushPromises()
      expect(w.vm.$route.query.tab).toBe("domains")
      expect(w.find("#blocked-filter").exists()).toBe(true)
      expect(w.find(".feed-row").isVisible()).toBe(false)
      expect(w.find("#status-total").exists()).toBe(true)
    })

    it("opens on the tab named in the URL, and remembers the last one used", async () => {
      const named = await mountPage("check")
      expect(named.find("#check-domain").exists()).toBe(true)
      named.unmount()

      const first = await mountPage()
      await first.get("#blocked-tab-domains").trigger("click")
      await flushPromises()
      first.unmount()

      const w = await mountPage()
      expect(w.get("#blocked-tab-domains").attributes("aria-selected")).toBe("true")
    })

    it("only reads the blocked-domain tree once the Your domains tab is opened", async () => {
      const w = await mountPage()
      expect(listBlockedZones).not.toHaveBeenCalled()
      await w.get("#blocked-tab-domains").trigger("click")
      await flushPromises()
      expect(listBlockedZones).toHaveBeenCalled()
    })

    it("moves between tabs with the arrow keys", async () => {
      const w = await mountPage()
      await w.get("#blocked-tab-feeds").trigger("keydown", { key: "ArrowRight" })
      await flushPromises()
      expect(w.get("#blocked-tab-domains").attributes("aria-selected")).toBe("true")
      await w.get("#blocked-tab-domains").trigger("keydown", { key: "End" })
      await flushPromises()
      expect(w.get("#blocked-tab-check").attributes("aria-selected")).toBe("true")
    })
  })

  describe("status", () => {
    it("shows blocking state, domain total, and last and next update", async () => {
      const w = await mountPage()
      expect(w.get("#blocking-pill").text()).toBe("Blocking on")
      expect(w.text()).toContain("Blocked names answer NxDomain")
      expect(w.get("#status-total").text()).toBe("1,203,411")
      expect(w.get("#status-last").text()).toBe("8 h ago") // next in 4 h, every 12 h
      expect(w.get("#status-next").text()).toBe("in 4 h")
      expect(w.text()).toContain("Every 12 hours")
    })

    it("says when blocking is off, and when an update is overdue", async () => {
      vi.mocked(getSettings).mockResolvedValue(settings({ enableBlocking: false, blockListNextUpdatedOn: new Date(Date.now() - HOUR).toISOString() }))
      const w = await mountPage()
      expect(w.get("#blocking-pill").text()).toBe("Blocking off")
      expect(w.get("#status-next").text()).toBe("Overdue")
    })

    it("starts a history on the first visit, and shows the change once there is an earlier reading", async () => {
      const first = await mountPage()
      expect(first.find("#status-change").exists()).toBe(false)
      expect(first.find("#history-empty").exists()).toBe(true)
      first.unmount()

      localStorage.setItem("resolvr.blockListHistory", JSON.stringify([{ t: Date.now() - 24 * HOUR, total: 1000000 }]))
      clearCache()
      const w = await mountPage()
      expect(w.get("#status-change").text()).toContain("+203,411 since the previous refresh")
      expect(w.findAll(".history-row")).toHaveLength(2)
    })

    it("shows a readable error, not a raw stack trace, when settings fail to load", async () => {
      vi.mocked(getSettings).mockRejectedValue(new TechnitiumApiError("Invalid token or session expired.", 401))
      const w = await mountPage()
      expect(w.get("#settings-error").text()).toBe("Invalid token or session expired.")
    })

    it("still shows everything else when the domain total cannot be loaded", async () => {
      vi.mocked(getDashboardStats).mockRejectedValue(new Error("boom"))
      const w = await mountPage()
      expect(w.get("#status-total").text()).toBe("–")
      expect(w.find("#settings-error").exists()).toBe(false)
    })

    it("offers no 'Update now' control to any role", async () => {
      const w = await mountPage()
      expect(w.find("#update-now").exists()).toBe(false)
      expect(w.find("#update-progress").exists()).toBe(false)
      expect(w.find("#update-error").exists()).toBe(false)
      expect(w.text()).toContain("read-only")
    })
  })

  describe("feeds", () => {
    it("lists the configured feeds under their headings, read-only", async () => {
      const w = await mountPage()
      expect(w.findAll(".group-name").map((i) => i.text())).toEqual(["General threat intel", "Ads and trackers"])
      expect(w.findAll(".feed-row")).toHaveLength(2)
      expect(w.find("#new-feed-url").exists()).toBe(false)
      expect(w.find(".feed-remove").exists()).toBe(false)
      expect(w.find("#feeds-savebar").exists()).toBe(false)
      expect(w.find("#feeds-text-mode").exists()).toBe(false)
      expect(w.text()).toContain("read-only")
    })

    it("points at a matched feed", async () => {
      vi.mocked(resolveDnsQuery).mockResolvedValue({
        response: { result: { RCODE: "NxDomain", Answer: [], EDNS: { Options: [{ Code: "EXTENDED_DNS_ERROR", Data: { InfoCode: "Blocked", ExtraText: "source=block-list-zone; blockListUrl=https://b.example.org/ads.txt; domain=ads.example.net" } }] } } },
      } as never)
      const w = await mountPage("check")
      await w.get("#check-domain").setValue("ads.example.net")
      await w.get("#check-go").trigger("click")
      await flushPromises()
      await w.get("#show-feed").trigger("click")
      await flushPromises()
      const matched = w.findAll(".feed-row").find((r) => r.text().includes("b.example.org"))!
      expect(matched.text()).toContain("Matched")
    })
  })

  describe("your blocked domains", () => {
    it("lists every blocked domain found by walking the tree, not just the root labels", async () => {
      const w = await mountPage("domains")
      expect(w.findAll(".blocked-row").map((r) => r.find("span").text())).toEqual(["ads.example.net", "example.com"])
      expect(w.get("#blocked-count").text()).toBe("2 of 2")
    })

    it("filters the list", async () => {
      const w = await mountPage("domains")
      await w.get("#blocked-filter").setValue("ads")
      expect(w.findAll(".blocked-row")).toHaveLength(1)
      expect(w.get("#blocked-count").text()).toBe("1 of 2")
    })

    it("offers no block or unblock controls to any role", async () => {
      const w = await mountPage("domains")
      expect(w.find("#new-blocked-domain").exists()).toBe(false)
      expect(w.find("#add-blocked-domain").exists()).toBe(false)
      expect(w.find(".row-unblock").exists()).toBe(false)
      expect(w.find("#bulk-toggle").exists()).toBe(false)
      expect(w.find("#undo-toast").exists()).toBe(false)
      expect(w.findAll(".blocked-row")).toHaveLength(2)
      expect(w.text()).toContain("read-only")
    })

    it("exports the blocked zones as a download", async () => {
      const file = { blob: new Blob(["x"]), filename: "blocked.txt" }
      vi.mocked(exportBlockedZones).mockResolvedValue(file as never)
      const w = await mountPage("domains")
      await w.get("#export-blocked").trigger("click")
      await flushPromises()
      expect(triggerDownload).toHaveBeenCalledWith(file)
    })

    it("shows an error when the tree cannot be read, and an empty state when nothing is blocked", async () => {
      vi.mocked(listBlockedZones).mockRejectedValue(new TechnitiumApiError("Server unreachable.", 502))
      const bad = await mountPage("domains")
      expect(bad.get("#blocked-error").text()).toBe("Server unreachable.")
      bad.unmount()

      clearCache()
      vi.mocked(listBlockedZones).mockResolvedValue({ response: { domain: "", zones: [], records: [] } } as never)
      const empty = await mountPage("domains")
      expect(empty.text()).toContain("You have not blocked any domains yet")
    })

    it("can still browse the tree, read-only", async () => {
      const w = await mountPage("domains")
      const details = w.get("details")
      ;(details.element as HTMLDetailsElement).open = true
      await details.trigger("toggle")
      await flushPromises()
      expect(w.get("#blocked-zone-tree").text()).toContain("com")
      expect(w.find(".zone-tree-remove").exists()).toBe(false)
    })

    it("refetches everything when the topbar refresh button is used", async () => {
      const w = await mountPage("domains")
      vi.mocked(getSettings).mockClear()
      vi.mocked(listBlockedZones).mockClear()
      useRefreshStore().trigger()
      await flushPromises()
      expect(getSettings).toHaveBeenCalledTimes(1)
      expect(listBlockedZones).toHaveBeenCalled()
      expect(w.get("#blocked-count").text()).toBe("2 of 2")
    })
  })

  describe("check a domain", () => {
    const blockedBy = (extra: string) =>
      ({ response: { result: { RCODE: "NxDomain", Answer: [], EDNS: { Options: [{ Code: "EXTENDED_DNS_ERROR", Data: { InfoCode: "Blocked", ExtraText: extra } }] } } } }) as never

    it("names the feed that blocked a domain, and points at it in the feeds list", async () => {
      vi.mocked(resolveDnsQuery).mockResolvedValue(blockedBy("source=block-list-zone; blockListUrl=https://b.example.org/ads.txt; domain=ads.example.net"))
      const w = await mountPage("check")
      await w.get("#check-domain").setValue("ads.example.net")
      await w.get("#check-go").trigger("click")
      await flushPromises()
      expect(resolveDnsQuery).toHaveBeenCalledWith("ads.example.net", "A", expect.anything(), expect.objectContaining({ server: "this-server" }))
      expect(w.get("#check-verdict").text()).toContain("matches a feed: https://b.example.org/ads.txt")
      await w.get("#show-feed").trigger("click")
      await flushPromises()
      expect(w.get("#blocked-tab-feeds").attributes("aria-selected")).toBe("true")
      const matched = w.findAll(".feed-row").find((r) => r.text().includes("b.example.org"))!
      expect(matched.text()).toContain("Matched")
    })

    it("says a name on your own list is blocked, and highlights it", async () => {
      vi.mocked(resolveDnsQuery).mockResolvedValue(blockedBy("source=blocked-zone; domain=example.com"))
      const w = await mountPage("check")
      await w.get("#check-domain").setValue("www.example.com")
      await w.get("#check-go").trigger("click")
      await flushPromises()
      expect(w.get("#check-verdict").text()).toContain("is on your blocked domains (through example.com)")
      await w.get("#show-domain").trigger("click")
      await flushPromises()
      expect(w.get("#blocked-tab-domains").attributes("aria-selected")).toBe("true")
      expect(w.find("#blocked-domain-list").exists()).toBe(true)
    })

    it("reports an allowed name with its addresses, and a name that does not exist", async () => {
      vi.mocked(resolveDnsQuery).mockResolvedValue({ response: { result: { RCODE: "NoError", Answer: [{ RDATA: { IPAddress: "192.0.2.1" } }], EDNS: { Options: [] } } } } as never)
      const w = await mountPage("check")
      await w.get("#check-domain").setValue("www.example.org")
      await w.get("#check-go").trigger("click")
      await flushPromises()
      expect(w.get("#check-verdict").text()).toContain("Allowed. Your server answers www.example.org normally with 192.0.2.1")

      vi.mocked(resolveDnsQuery).mockResolvedValue({ response: { result: { RCODE: "NxDomain", Answer: [], EDNS: { Options: [] } } } } as never)
      await w.get("#check-go").trigger("click")
      await flushPromises()
      expect(w.get("#check-verdict").text()).toContain("does not exist, and it is not blocked")
    })

    it("asks for a real domain, and shows a readable error when the server cannot be asked", async () => {
      const w = await mountPage("check")
      await w.get("#check-domain").setValue("nope")
      await w.get("#check-go").trigger("click")
      expect(w.get("#check-message").text()).toContain("Enter a domain")
      expect(resolveDnsQuery).not.toHaveBeenCalled()

      vi.mocked(resolveDnsQuery).mockRejectedValue(new TechnitiumApiError("Server unreachable.", 502))
      await w.get("#check-domain").setValue("example.org")
      await w.get("#check-go").trigger("click")
      await flushPromises()
      expect(w.get("#check-message").text()).toBe("Server unreachable.")
    })
  })
})
