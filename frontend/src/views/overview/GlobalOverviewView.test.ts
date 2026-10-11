import { describe, it, expect, vi, beforeEach } from "vitest"
import { mount, flushPromises } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"
import { createRouter, createMemoryHistory } from "vue-router"

vi.mock("../../api/app", async () => {
  const actual = await vi.importActual<typeof import("../../api/app")>("../../api/app")
  return { ...actual, getOverview: vi.fn() }
})

import { getOverview, AppApiError, type OverviewServer } from "../../api/app"
import { useAuthStore } from "../../stores/auth"
import GlobalOverviewView from "./GlobalOverviewView.vue"

function server(over: Partial<OverviewServer> = {}): OverviewServer {
  return {
    id: 1,
    name: "Home",
    connected: true,
    serverDomain: "dns.villa58.lan",
    serverVersion: "15.4",
    totalQueries: 5133,
    totalBlocked: 1643,
    error: null,
    ...over,
  }
}

async function mountView() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "overview-all", component: GlobalOverviewView },
      { path: "/env/:envId/overview", name: "overview", component: { template: "<div />" } },
      { path: "/connect", name: "connect", component: { template: "<div />" } },
    ],
  })
  await router.push("/")
  const wrapper = mount(GlobalOverviewView, { global: { plugins: [router] } })
  await flushPromises()
  return { wrapper, router }
}

describe("GlobalOverviewView", () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(getOverview).mockReset()
  })

  it("renders a row per server with health, version, and query counts", async () => {
    vi.mocked(getOverview).mockResolvedValue({
      window: "LastHour",
      environments: [
        server(),
        server({ id: 2, name: "Office", serverDomain: "dns.office.lan", totalQueries: null, totalBlocked: null, error: null }),
      ],
    })

    const { wrapper } = await mountView()

    expect(wrapper.text()).toContain("All Servers")
    const rows = wrapper.findAll("#server-list > li")
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain("Home")
    expect(rows[0]!.text()).toContain("dns.villa58.lan")
    expect(rows[0]!.text()).toContain("v15.4")
    expect(rows[0]!.text()).toContain("5,133")
    expect(rows[0]!.text()).toContain("1,643")
    // A server that answered but reported no stats says so instead of "0".
    expect(rows[1]!.text()).toContain("Statistics unavailable")
  })

  it("shows the per-server error inline without collapsing the list", async () => {
    vi.mocked(getOverview).mockResolvedValue({
      window: "LastHour",
      environments: [
        server({ connected: false, error: "Could not reach the server" }),
        server({ id: 2, name: "Office" }),
      ],
    })

    const { wrapper } = await mountView()

    expect(wrapper.text()).toContain("Could not reach the server")
    expect(wrapper.findAll("#server-list > li")).toHaveLength(2)
  })

  it("shows a readable error state when the overview request fails", async () => {
    vi.mocked(getOverview).mockRejectedValue(new AppApiError("Not authenticated", 401))

    const { wrapper } = await mountView()

    expect(wrapper.get("#overview-error").text()).toBe("Not authenticated")
  })

  it("prompts to add the first server when none are configured", async () => {
    vi.mocked(getOverview).mockResolvedValue({ window: "LastHour", environments: [] })
    useAuthStore().user = { id: 1, username: "admin", role: "admin" }

    const { wrapper } = await mountView()

    expect(wrapper.text()).toContain("No Technitium servers are configured yet.")
    expect(wrapper.text()).toContain("Add your first server")
  })

  it("opens a server's own overview when its row is clicked", async () => {
    vi.mocked(getOverview).mockResolvedValue({
      window: "LastHour",
      environments: [server(), server({ id: 2, name: "Office" })],
    })

    const { wrapper, router } = await mountView()
    await wrapper.findAll("#server-list > li")[1]!.find("button").trigger("click")
    await flushPromises()

    expect(router.currentRoute.value.name).toBe("overview")
    expect(router.currentRoute.value.params.envId).toBe("2")
  })

  it("shows the Manage servers link only to admins", async () => {
    vi.mocked(getOverview).mockResolvedValue({ window: "LastHour", environments: [server()] })

    useAuthStore().user = { id: 2, username: "reader", role: "viewer" }
    expect((await mountView()).wrapper.text()).not.toContain("Manage servers")

    useAuthStore().user = { id: 1, username: "admin", role: "admin" }
    expect((await mountView()).wrapper.text()).toContain("Manage servers")
  })
})
