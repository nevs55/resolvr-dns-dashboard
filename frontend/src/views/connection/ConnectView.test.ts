import { describe, it, expect, vi, beforeEach } from "vitest"
import { mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"

vi.mock("../../api/app", async () => {
  const actual = await vi.importActual<typeof import("../../api/app")>("../../api/app")
  return {
    ...actual,
    listEnvironments: vi.fn(),
    createEnvironment: vi.fn(),
    updateEnvironment: vi.fn(),
    deleteEnvironment: vi.fn(),
    getStatus: vi.fn(),
  }
})

import { listEnvironments, createEnvironment, updateEnvironment, deleteEnvironment, getStatus, AppApiError } from "../../api/app"
import ConnectView from "./ConnectView.vue"

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe("ConnectView", () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.mocked(createEnvironment).mockReset()
    vi.mocked(updateEnvironment).mockReset()
    vi.mocked(deleteEnvironment).mockReset()
    vi.mocked(getStatus).mockResolvedValue({ configured: true, connected: true, serverDomain: null, serverVersion: null })
  })

  it("lists the configured servers with their URLs", async () => {
    vi.mocked(listEnvironments).mockResolvedValue({
      managed: false,
      environments: [
        { id: 1, name: "Home", baseUrl: "http://10.0.60.60:5380" },
        { id: 2, name: "Office", baseUrl: "http://10.0.70.70:5380" },
      ],
    })
    const wrapper = mount(ConnectView)
    await flushPromises()

    expect(wrapper.find("#server-list").exists()).toBe(true)
    expect(wrapper.text()).toContain("Home")
    expect(wrapper.text()).toContain("Office")
    expect(wrapper.text()).toContain("http://10.0.60.60:5380")
  })

  it("adds a server by name, URL and token", async () => {
    vi.mocked(listEnvironments).mockResolvedValue({ managed: false, environments: [] })
    vi.mocked(createEnvironment).mockResolvedValue({
      environment: { id: 1, name: "Home", baseUrl: "http://10.0.60.60:5380" },
      serverDomain: "dns.villa58.lan",
      serverVersion: "15.4",
    })
    const wrapper = mount(ConnectView)
    await flushPromises()

    await wrapper.find("#env-name").setValue("Home")
    await wrapper.find("#env-url").setValue("http://10.0.60.60:5380")
    await wrapper.find("#env-token").setValue("secret-token")
    await wrapper.find("#add-env-form").trigger("submit")
    await flushPromises()

    expect(createEnvironment).toHaveBeenCalledWith("Home", "http://10.0.60.60:5380", "secret-token")
  })

  it("shows a readable inline error on a failed add", async () => {
    vi.mocked(listEnvironments).mockResolvedValue({ managed: false, environments: [] })
    vi.mocked(createEnvironment).mockRejectedValue(new AppApiError("Invalid token or session expired.", 400))
    const wrapper = mount(ConnectView)
    await flushPromises()

    await wrapper.find("#env-name").setValue("Home")
    await wrapper.find("#env-url").setValue("http://10.0.60.60:5380")
    await wrapper.find("#env-token").setValue("bad")
    await wrapper.find("#add-env-form").trigger("submit")
    await flushPromises()

    expect(wrapper.find("#connection-error").text()).toBe("Invalid token or session expired.")
  })

  it("shows the read-only note and no add form when the add-on owns the connection", async () => {
    vi.mocked(listEnvironments).mockResolvedValue({
      managed: true,
      environments: [{ id: 1, name: "Default", baseUrl: "http://dns.example.lan:5380" }],
    })
    const wrapper = mount(ConnectView)
    await flushPromises()

    expect(wrapper.find("#connection-managed").exists()).toBe(true)
    expect(wrapper.text()).toContain("Configuration")
    expect(wrapper.find("#add-env-form").exists()).toBe(false)
  })
})
