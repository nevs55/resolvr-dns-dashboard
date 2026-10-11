import { describe, it, expect } from "vitest"
import { mount } from "@vue/test-utils"
import BlockListFeeds from "./BlockListFeeds.vue"

const LINES = ["# Threat intel", "https://a.example.com/t.txt", "https://b.example.org/m.txt", "# Ads", "https://c.example.net/a.txt"]

function mountFeeds(over: Record<string, unknown> = {}) {
  return mount(BlockListFeeds, { props: { lines: LINES, highlightUrl: null, ...over } })
}

const urls = (w: ReturnType<typeof mountFeeds>) => w.findAll(".feed-row").map((r) => r.find("a").text())

describe("BlockListFeeds", () => {
  it("shows feeds under their headings with a count", () => {
    const w = mountFeeds()
    expect(w.findAll(".group-name").map((i) => i.text())).toEqual(["Threat intel", "Ads"])
    expect(urls(w)).toHaveLength(3)
    expect(w.findAll(".feed-group")[0]!.text()).toContain("2 feeds")
    expect(w.findAll(".feed-group")[1]!.text()).toContain("1 feed")
    expect(w.findAll(".feed-group")[1]!.text()).not.toContain("1 feeds")
  })

  it("shows a heading-free list as Ungrouped", () => {
    const w = mountFeeds({ lines: ["https://a.example.com/t.txt"] })
    expect(w.get(".group-name").text()).toBe("Ungrouped")
  })

  it("points at a matched feed", () => {
    const w = mountFeeds({ highlightUrl: "https://b.example.org/m.txt" })
    const row = w.findAll(".feed-row").find((r) => r.text().includes("b.example.org"))!
    expect(row.text()).toContain("Matched")
  })

  it("is read-only: no add, remove, reorder, text-mode, or save controls", () => {
    const w = mountFeeds()
    expect(w.find("#new-feed-url").exists()).toBe(false)
    expect(w.find(".feed-remove").exists()).toBe(false)
    expect(w.find(".feed-up").exists()).toBe(false)
    expect(w.find(".feed-down").exists()).toBe(false)
    expect(w.find(".group-remove").exists()).toBe(false)
    expect(w.find("#feeds-text-mode").exists()).toBe(false)
    expect(w.find("#feeds-savebar").exists()).toBe(false)
    expect(w.text()).toContain("read-only")
  })

  it("shows an empty state when there are no feeds", () => {
    const w = mountFeeds({ lines: [] })
    expect(w.get("#feeds-empty").text()).toContain("No feeds configured")
  })
})

describe("BlockListFeeds with divider headings", () => {
  const REAL = [
    "# --- AdGuard parity ---",
    "# ---AdGuard DNS filter---",
    "https://adguardteam.github.io/HostlistsRegistry/assets/filter_1.txt",
    "# EasyList Privacy",
    "https://v.firebog.net/hosts/Easyprivacy.txt",
    "# --- Adult / parental (multiple sources) ---",
    "# Hagezi NSFW",
    "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/hosts/nsfw.txt",
  ]
  const mountReal = () => mount(BlockListFeeds, { props: { lines: REAL, highlightUrl: null } })

  it("shows heading-only lines as dividers instead of empty feed groups", () => {
    const w = mountReal()
    const groups = w.findAll(".feed-group")
    expect(groups).toHaveLength(5)
    expect(groups[0]!.find(".group-count").text()).toBe("Divider")
    expect(groups[1]!.find(".group-count").text()).toBe("1 feed")
  })
})
