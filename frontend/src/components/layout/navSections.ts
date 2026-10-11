export type NavIconName =
  | "overview"
  | "clients"
  | "logs"
  | "cache"
  | "zones"
  | "allowed"
  | "blocked"
  | "dhcp"
  | "resolver"
  | "apps"
  | "server"
  | "sessions"
  | "connect"
  | "users"

export interface NavItem {
  // Vue Router route name (see router/index.ts).
  name: string
  label: string
  icon: NavIconName
  adminOnly?: boolean
  // Hidden when Home Assistant does the signing in (there are no accounts to manage).
  localAccountsOnly?: boolean
  // Scoped to the active environment: renders under /env/:envId/... and is
  // hidden until an environment is selected.
  scoped?: boolean
}

export interface NavSection {
  label: string | null
  items: NavItem[]
}

// Mirrors the sidebar structure in the approved wireframe
// (https://claude.ai/artifact/KkUP4PePeDz4kVDA7ULDpM), extended with an
// "All Servers" landing page for the global overview. `icon` matches a case
// in components/layout/NavIcon.vue.
export const navSections: NavSection[] = [
  { label: null, items: [{ name: "overview-all", label: "All Servers", icon: "overview" }] },
  {
    label: "Monitoring",
    items: [
      { name: "overview", label: "Overview", icon: "overview", scoped: true },
      { name: "clients", label: "Clients", icon: "clients", scoped: true },
      { name: "logs", label: "Query Logs", icon: "logs", scoped: true },
      { name: "cache", label: "Cache", icon: "cache", scoped: true },
    ],
  },
  {
    label: "DNS Zones",
    items: [
      { name: "zones", label: "Zones", icon: "zones", scoped: true },
      { name: "allowed", label: "Allowed Zones", icon: "allowed", scoped: true },
      { name: "blocked", label: "Blocked Zones", icon: "blocked", scoped: true },
    ],
  },
  { label: "Network", items: [{ name: "dhcp", label: "DHCP", icon: "dhcp", scoped: true }] },
  { label: "Tools", items: [{ name: "resolver", label: "DNS Resolver", icon: "resolver", scoped: true }] },
  {
    label: "System",
    items: [
      { name: "apps", label: "Apps", icon: "apps", scoped: true },
      { name: "server", label: "Server Info", icon: "server", scoped: true },
      { name: "sessions", label: "Sessions", icon: "sessions", scoped: true },
      { name: "users", label: "Users", icon: "users", adminOnly: true, localAccountsOnly: true },
    ],
  },
]
