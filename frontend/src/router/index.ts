import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router"
import type { Component } from "vue"

declare module "vue-router" {
  interface RouteMeta {
    public?: boolean
    requiresAdmin?: boolean
    // Only makes sense with Resolvr's own accounts, so it is out of reach
    // when Home Assistant does the signing in.
    localAccountsOnly?: boolean
  }
}

import GlobalOverviewView from "../views/overview/GlobalOverviewView.vue"
import OverviewView from "../views/overview/OverviewView.vue"
import ClientsView from "../views/monitoring/ClientsView.vue"
import QueryLogsView from "../views/monitoring/QueryLogsView.vue"
import CacheView from "../views/monitoring/CacheView.vue"
import ZonesView from "../views/zones/ZonesView.vue"
import AllowedZonesView from "../views/zones/AllowedZonesView.vue"
import BlockedZonesView from "../views/zones/BlockedZonesView.vue"
import DhcpView from "../views/network/DhcpView.vue"
import ResolverView from "../views/tools/ResolverView.vue"
import AppsView from "../views/system/AppsView.vue"
import ServerInfoView from "../views/system/ServerInfoView.vue"
import SessionsView from "../views/system/SessionsView.vue"
import UsersView from "../views/system/UsersView.vue"
import ConnectView from "../views/connection/ConnectView.vue"
import LoginView from "../views/auth/LoginView.vue"
import { useAuthStore } from "../stores/auth"

// Every per-server page lives under /env/:envId/..., so each environment has
// its own URL, browser history, and deep-linkable views. The top-level `/`
// is the global overview across all servers. Connection Settings manages the
// whole list and stays unscoped.
//
// The page may be served under a path prefix (Home Assistant ingress); the
// server writes that prefix into <base href>, so routes are relative to it.
const routerBase = typeof document !== "undefined" ? new URL(document.baseURI).pathname : "/"

function envRoutes(): RouteRecordRaw[] {
  // (path segment, route name, component) triples mirroring the sidebar.
  const defs: [string, string, Component][] = [
    ["overview", "overview", OverviewView],
    ["clients", "clients", ClientsView],
    ["logs", "logs", QueryLogsView],
    ["cache", "cache", CacheView],
    ["zones", "zones", ZonesView],
    ["allowed", "allowed", AllowedZonesView],
    ["blocked", "blocked", BlockedZonesView],
    ["dhcp", "dhcp", DhcpView],
    ["resolver", "resolver", ResolverView],
    ["apps", "apps", AppsView],
    ["server", "server", ServerInfoView],
    ["sessions", "sessions", SessionsView],
  ]
  return defs.map(([segment, name, component]) => ({
    path: `/env/:envId/${segment}`,
    name,
    component,
  }))
}

export const router = createRouter({
  history: createWebHistory(routerBase),
  routes: [
    { path: "/", name: "overview-all", component: GlobalOverviewView },
    ...envRoutes(),
    { path: "/users", name: "users", component: UsersView, meta: { requiresAdmin: true, localAccountsOnly: true } },
    { path: "/connect", name: "connect", component: ConnectView, meta: { requiresAdmin: true } },
    { path: "/login", name: "login", component: LoginView, meta: { public: true } },
  ],
})

// Every route requires a signed-in session except /login. A route
// tagged requiresAdmin (Users, Connection Settings — both able to
// change what every other user sees) additionally requires the admin
// role; a viewer hitting one is sent back to Overview rather than
// shown a 403 page, since it's not something they'd ever click into
// deliberately.
router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (!auth.checked) await auth.checkSession()

  if (!to.meta.public && !auth.isAuthenticated) {
    return { name: "login", query: { redirect: to.fullPath } }
  }
  if (to.name === "login" && auth.isAuthenticated) {
    return { path: "/" }
  }
  if (to.meta.requiresAdmin && !auth.isAdmin) {
    return { path: "/" }
  }
  if (to.meta.localAccountsOnly && auth.external) {
    return { path: "/" }
  }
  return true
})
