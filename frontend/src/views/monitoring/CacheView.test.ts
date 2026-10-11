import { describe, it, expect, vi, beforeEach } from "vitest"
import { mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"

vi.mock("../../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../../api/technitium")>("../../api/technitium")
  return { ...actual, listCache: vi.fn() }
})

import { listCache, TechnitiumApiError } from "../../api/technitium"
import { useConnectionStore } from "../../stores/connection"
import { useAuthStore } from "../../stores/auth"
import CacheView from "./CacheView.vue"

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function mountConnected() {
  const wrapper = mount(CacheView, { global: { stubs: { RouterLink: true } } })
  const connection = useConnectionStore()
  connection.isConfigured = true
  await flushPromises()
  return wrapper
}

describe("CacheView", () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.mocked(listCache).mockReset()
  })

  it("renders cached records for a domain the user browses to", async () => {
    vi.mocked(listCache).mockResolvedValue({
      response: {
        domain: "google.com",
        zones: [],
        records: [
          { name: "google.com", type: "A", ttl: "283 (4 mins 43 sec)", rData: { value: "216.58.199.174" } },
        ],
      },
    })
    const wrapper = await mountConnected()

    await wrapper.get("#cache-domain").setValue("google.com")
    await wrapper.get("form").trigger("submit")
    await flushPromises()

    expect(listCache).toHaveBeenCalledWith("google.com", expect.anything())
    expect(wrapper.text()).toContain("216.58.199.174")
    expect(wrapper.text()).toContain("283 (4 mins 43 sec)")
  })

  it("shows a clear empty state, not an error, when nothing is cached for the domain", async () => {
    vi.mocked(listCache).mockResolvedValue({ response: { domain: "unknown.example", zones: [], records: [] } })
    const wrapper = await mountConnected()

    await wrapper.get("#cache-domain").setValue("unknown.example")
    await wrapper.get("form").trigger("submit")
    await flushPromises()

    expect(wrapper.find("#cache-empty").exists()).toBe(true)
    expect(wrapper.find("#cache-error").exists()).toBe(false)
  })

  it("shows a readable inline error, not a raw stack trace, on failure", async () => {
    vi.mocked(listCache).mockRejectedValue(new TechnitiumApiError("Invalid domain name.", 200))
    const wrapper = await mountConnected()

    await wrapper.get("#cache-domain").setValue("bad domain")
    await wrapper.get("form").trigger("submit")
    await flushPromises()

    expect(wrapper.find("#cache-error").text()).toBe("Invalid domain name.")
  })

  it("disables the Browse button and shows a loading label while the fetch is in flight", async () => {
    let resolveFetch: (value: Awaited<ReturnType<typeof listCache>>) => void = () => {}
    vi.mocked(listCache).mockReturnValue(new Promise((resolve) => (resolveFetch = resolve)))
    const wrapper = await mountConnected()

    await wrapper.get("#cache-domain").setValue("google.com")
    await wrapper.get("form").trigger("submit")
    await wrapper.vm.$nextTick()

    const button = wrapper.get("#browse-cache")
    expect(button.attributes("disabled")).toBeDefined()
    expect(button.text()).toBe("Browsing…")

    resolveFetch({ response: { domain: "google.com", zones: [], records: [] } })
    await flushPromises()

    expect(wrapper.get("#browse-cache").text()).toBe("Browse")
  })

  it("offers no flush-cache control to any role — the page is read-only", async () => {
    useAuthStore().user = { id: 1, username: "admin", role: "admin" }
    const wrapper = await mountConnected()

    expect(wrapper.find("#flush-cache").exists()).toBe(false)
    expect(wrapper.find("#confirm-flush-cache").exists()).toBe(false)
    expect(wrapper.find("#flush-cache-error").exists()).toBe(false)
  })

  describe("tree browsing (regression: /api/cache/list is a domain-tree browser, not a flat lookup)", () => {
    it("shows cached subdomains as clickable chips when a domain has no records of its own", async () => {
      // Confirmed live: browsing "google.com" itself can return zones
      // (cached subdomains like www.google.com) alongside its own
      // records — but a domain with ONLY zones and no records used to
      // render a table with headers and zero rows, looking blank, with
      // the zones silently discarded.
      vi.mocked(listCache).mockResolvedValue({
        response: { domain: "google.com", zones: ["www.google.com", "l.google.com"], records: [] },
      })
      const wrapper = await mountConnected()

      await wrapper.get("#cache-domain").setValue("google.com")
      await wrapper.get("form").trigger("submit")
      await flushPromises()

      expect(wrapper.find("#cache-empty").exists()).toBe(false)
      expect(wrapper.text()).toContain("www.google.com")
      expect(wrapper.text()).toContain("l.google.com")
    })

    it("browses into a subdomain when its chip is clicked", async () => {
      vi.mocked(listCache)
        .mockResolvedValueOnce({ response: { domain: "google.com", zones: ["www.google.com"], records: [] } })
        .mockResolvedValueOnce({
          response: {
            domain: "www.google.com",
            zones: [],
            records: [{ name: "www.google.com", type: "A", ttl: "120", rData: { value: "1.2.3.4" } }],
          },
        })
      const wrapper = await mountConnected()
      await wrapper.get("#cache-domain").setValue("google.com")
      await wrapper.get("form").trigger("submit")
      await flushPromises()

      await wrapper.get(".cache-zone-chip").trigger("click")
      await flushPromises()

      expect(listCache).toHaveBeenCalledWith("www.google.com", expect.anything())
      expect((wrapper.get("#cache-domain").element as HTMLInputElement).value).toBe("www.google.com")
      expect(wrapper.text()).toContain("1.2.3.4")
    })

    it("allows browsing from the root with an empty domain", async () => {
      vi.mocked(listCache).mockResolvedValue({
        response: { domain: "", zones: ["com", "org", "net"], records: [] },
      })
      const wrapper = await mountConnected()

      await wrapper.get("form").trigger("submit") // domain left blank

      await flushPromises()

      expect(listCache).toHaveBeenCalledWith("", expect.anything())
      expect(wrapper.text()).toContain("Cached top-level domains")
      expect(wrapper.text()).toContain("com")
    })

    it("shows both the subdomain chips and the domain's own records when both are present", async () => {
      vi.mocked(listCache).mockResolvedValue({
        response: {
          domain: "google.com",
          zones: ["www.google.com"],
          records: [{ name: "google.com", type: "A", ttl: "266", rData: { value: "142.251.37.142" } }],
        },
      })
      const wrapper = await mountConnected()

      await wrapper.get("#cache-domain").setValue("google.com")
      await wrapper.get("form").trigger("submit")
      await flushPromises()

      expect(wrapper.text()).toContain("www.google.com")
      expect(wrapper.text()).toContain("142.251.37.142")
    })
  })
})
