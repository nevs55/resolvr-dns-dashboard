import { describe, it, expect, vi, beforeEach } from "vitest"
import { createPinia, setActivePinia } from "pinia"

vi.mock("../api/app", async () => {
  const actual = await vi.importActual<typeof import("../api/app")>("../api/app")
  return {
    ...actual,
    getStatus: vi.fn(),
    listEnvironments: vi.fn(),
    createEnvironment: vi.fn(),
    updateEnvironment: vi.fn(),
    deleteEnvironment: vi.fn(),
  }
})

import { getStatus, listEnvironments, createEnvironment, AppApiError } from "../api/app"
import { useConnectionStore } from "./connection"
import { getActiveEnvironmentId } from "../lib/activeEnv"

const ENV = { id: 1, name: "Home", baseUrl: "http://10.0.60.60:5380" }
const ENV2 = { id: 2, name: "Office", baseUrl: "http://10.0.70.70:5380" }

describe("connection store", () => {
  beforeEach(() => {
    sessionStorage.clear()
    setActivePinia(createPinia())
    vi.mocked(getStatus).mockReset()
    vi.mocked(listEnvironments).mockReset()
    vi.mocked(createEnvironment).mockReset()
  })

  it("starts with no environments and no active selection", () => {
    const store = useConnectionStore()

    expect(store.environments).toEqual([])
    expect(store.activeEnvId).toBeUndefined()
    expect(store.isConfigured).toBe(false)
    expect(store.status).toBe("idle")
  })

  it("loadEnvironments selects the first environment and tests its connection", async () => {
    vi.mocked(listEnvironments).mockResolvedValue({ environments: [ENV, ENV2], managed: false })
    vi.mocked(getStatus).mockResolvedValue({
      configured: true,
      connected: true,
      serverDomain: "dns.villa58.lan",
      serverVersion: "15.4",
    })
    const store = useConnectionStore()

    await store.loadEnvironments()

    expect(store.environments).toEqual([ENV, ENV2])
    expect(store.activeEnvId).toBe(1)
    expect(getStatus).toHaveBeenCalledWith(1)
    expect(store.status).toBe("connected")
    expect(store.serverDomain).toBe("dns.villa58.lan")
    // The module-level active environment follows, so API calls get `env`.
    expect(getActiveEnvironmentId()).toBe(1)
  })

  it("restores the last-selected environment from sessionStorage", async () => {
    sessionStorage.setItem("resolvr.activeEnv", "2")
    vi.mocked(listEnvironments).mockResolvedValue({ environments: [ENV, ENV2], managed: false })
    vi.mocked(getStatus).mockResolvedValue({
      configured: true,
      connected: true,
      serverDomain: null,
      serverVersion: null,
    })
    const store = useConnectionStore()

    await store.loadEnvironments()

    expect(store.activeEnvId).toBe(2)
    expect(getStatus).toHaveBeenCalledWith(2)
  })

  it("selectEnvironment retargets the active id and the API layer", async () => {
    vi.mocked(listEnvironments).mockResolvedValue({ environments: [ENV, ENV2], managed: false })
    vi.mocked(getStatus).mockResolvedValue({
      configured: true,
      connected: true,
      serverDomain: null,
      serverVersion: null,
    })
    const store = useConnectionStore()
    await store.loadEnvironments()
    expect(store.activeEnvId).toBe(1)

    await store.selectEnvironment(2)

    expect(store.activeEnvId).toBe(2)
    expect(getActiveEnvironmentId()).toBe(2)
    expect(sessionStorage.getItem("resolvr.activeEnv")).toBe("2")
  })

  it("createEnv adds a server via the API and reloads the list", async () => {
    vi.mocked(createEnvironment).mockResolvedValue({
      environment: ENV,
      serverDomain: "dns.villa58.lan",
      serverVersion: "15.4",
    })
    vi.mocked(listEnvironments).mockResolvedValue({ environments: [ENV], managed: false })
    vi.mocked(getStatus).mockResolvedValue({
      configured: true,
      connected: true,
      serverDomain: "dns.villa58.lan",
      serverVersion: "15.4",
    })
    const store = useConnectionStore()

    await store.createEnv("Home", "http://10.0.60.60:5380", "secret")

    expect(createEnvironment).toHaveBeenCalledWith("Home", "http://10.0.60.60:5380", "secret")
    expect(listEnvironments).toHaveBeenCalled()
    expect(store.environments).toEqual([ENV])
  })

  it("surfaces a readable error when the status endpoint fails", async () => {
    vi.mocked(listEnvironments).mockResolvedValue({ environments: [ENV], managed: false })
    vi.mocked(getStatus).mockRejectedValue(new AppApiError("Not authenticated", 401))
    const store = useConnectionStore()

    await store.loadEnvironments()

    expect(store.status).toBe("error")
    expect(store.error).toBe("Not authenticated")
  })

  it("does not let a stale status response overwrite the newly selected environment", async () => {
    vi.mocked(listEnvironments).mockResolvedValue({ environments: [ENV, ENV2], managed: false })
    let resolveFirst!: (v: Awaited<ReturnType<typeof getStatus>>) => void
    vi.mocked(getStatus)
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r }))
      .mockResolvedValueOnce({ configured: true, connected: true, serverDomain: "dns.office.lan", serverVersion: "15.4" })
    const store = useConnectionStore()

    // Start loading; env 1's status request stays pending.
    const loading = store.loadEnvironments()
    await new Promise((r) => setTimeout(r, 0))
    expect(store.activeEnvId).toBe(1)
    expect(getStatus).toHaveBeenCalledWith(1)

    // Switch to env 2, whose status resolves immediately.
    await store.selectEnvironment(2)
    expect(store.serverDomain).toBe("dns.office.lan")

    // env 1's response finally arrives and must be dropped.
    resolveFirst({ configured: true, connected: false, serverDomain: "dns.home.lan", serverVersion: "15.3" })
    await loading

    expect(store.activeEnvId).toBe(2)
    expect(store.serverDomain).toBe("dns.office.lan")
    expect(store.status).toBe("connected")
  })
})
