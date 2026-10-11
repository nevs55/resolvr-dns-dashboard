import { describe, it, expect, vi, beforeEach } from "vitest"
import { createPinia, setActivePinia } from "pinia"

vi.mock("../api/app", async () => {
  const actual = await vi.importActual<typeof import("../api/app")>("../api/app")
  return { ...actual, fetchMe: vi.fn() }
})

import { fetchMe, AppApiError } from "../api/app"
import { router } from "./index"

describe("router auth guard", () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(fetchMe).mockReset()
  })

  it("redirects an unauthenticated visitor to /login, preserving the intended destination", async () => {
    vi.mocked(fetchMe).mockRejectedValue(new AppApiError("Not authenticated", 401))

    await router.push("/env/1/zones")

    expect(router.currentRoute.value.name).toBe("login")
    expect(router.currentRoute.value.query.redirect).toBe("/env/1/zones")
  })

  it("lets an authenticated viewer through to a scoped page", async () => {
    vi.mocked(fetchMe).mockResolvedValue({ id: 2, username: "reader", role: "viewer" })

    await router.push("/env/1/zones")

    expect(router.currentRoute.value.name).toBe("zones")
    expect(router.currentRoute.value.params.envId).toBe("1")
  })

  it("bounces a signed-in viewer away from an admin-only route (Connection Settings)", async () => {
    vi.mocked(fetchMe).mockResolvedValue({ id: 2, username: "reader", role: "viewer" })

    await router.push("/connect")

    expect(router.currentRoute.value.path).toBe("/")
  })

  it("lets an admin reach an admin-only route", async () => {
    vi.mocked(fetchMe).mockResolvedValue({ id: 1, username: "admin", role: "admin" })

    await router.push("/users")

    expect(router.currentRoute.value.path).toBe("/users")
  })

  it("redirects an already-authenticated visitor away from /login", async () => {
    vi.mocked(fetchMe).mockResolvedValue({ id: 1, username: "admin", role: "admin" })

    await router.push("/login")

    expect(router.currentRoute.value.path).toBe("/")
  })
})

describe("scoped routes", () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(fetchMe).mockResolvedValue({ id: 1, username: "admin", role: "admin" })
  })

  it("resolves each per-server page under /env/:envId with the envId param", async () => {
    await router.push("/env/2/logs")
    expect(router.currentRoute.value.name).toBe("logs")
    expect(router.currentRoute.value.params.envId).toBe("2")

    await router.push("/env/3/clients")
    expect(router.currentRoute.value.name).toBe("clients")
    expect(router.currentRoute.value.params.envId).toBe("3")
  })

  it("serves the global overview at / as overview-all (unscoped)", async () => {
    await router.push("/")
    expect(router.currentRoute.value.name).toBe("overview-all")
  })

  it("keeps the same route name when switching environments, only changing envId", async () => {
    await router.push("/env/1/overview")

    await router.push({ name: "overview", params: { envId: "5" } })

    expect(router.currentRoute.value.name).toBe("overview")
    expect(router.currentRoute.value.params.envId).toBe("5")
  })
})

describe("router when Home Assistant signs the user in", () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(fetchMe).mockReset()
  })

  it("keeps the user away from Users, which only makes sense with Resolvr's own accounts", async () => {
    vi.mocked(fetchMe).mockResolvedValue({ id: 0, username: "Bassem", role: "admin", external: true })
    await router.push("/env/1/zones")
    await router.push("/users")
    expect(router.currentRoute.value.path).toBe("/")
  })

  it("still lets that user into the other admin page", async () => {
    vi.mocked(fetchMe).mockResolvedValue({ id: 0, username: "Bassem", role: "admin", external: true })
    await router.push("/connect")
    expect(router.currentRoute.value.path).toBe("/connect")
  })
})

describe("router base", () => {
  it("is the path prefix the server wrote into <base href>", async () => {
    const base = document.createElement("base")
    base.href = "http://homeassistant.local:8123/api/hassio_ingress/aB3-_x9/"
    document.head.appendChild(base)
    vi.resetModules()
    const mod = await import("./index")
    expect(mod.router.options.history.base).toBe("/api/hassio_ingress/aB3-_x9")
    base.remove()
  })
})
