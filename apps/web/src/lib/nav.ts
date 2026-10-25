import type { Pillar } from "@operant/core";
import {
  Banknote,
  Building2,
  FolderKanban,
  LayoutDashboard,
  type LucideIcon,
  MessagesSquare,
  ScrollText,
  Settings,
  Users,
} from "lucide-react";

export interface NavChild {
  to: string;
  label: string;
  /** Only this exact path is active (overview pages). */
  exact?: boolean;
  /** Extra paths that also belong to this page (detail views). */
  also?: (pathname: string) => boolean;
}

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  pillar?: Pillar;
  /** Tailwind text color class for the pillar accent. */
  tone?: string;
  /** CSS colour for the item's icon. */
  color: string;
  hint?: string;
  children?: NavChild[];
}

const uuid = /^[0-9a-f-]{36}$/;

export const MAIN_NAV: NavItem[] = [
  { to: "/", label: "Home", icon: LayoutDashboard, color: "var(--color-brand-600)" },
  {
    to: "/people",
    label: "People",
    icon: Users,
    pillar: "people",
    tone: "text-people",
    color: "var(--people)",
    hint: "Directory, departments, leave",
    children: [
      { to: "/people", label: "Overview", exact: true },
      { to: "/people/directory", label: "Directory", also: (p) => p.startsWith("/people/") && uuid.test(p.slice(8)) },
      { to: "/people/org-chart", label: "Org chart" },
      { to: "/people/structure", label: "Departments and teams" },
      { to: "/people/leave", label: "Leave" },
      { to: "/people/onboarding", label: "Onboarding" },
    ],
  },
  {
    to: "/work",
    label: "Work",
    icon: FolderKanban,
    pillar: "work",
    tone: "text-work",
    color: "var(--work)",
    hint: "Projects, tasks, milestones",
    children: [
      { to: "/work", label: "My work", exact: true },
      { to: "/work/projects", label: "Projects" },
      { to: "/work/requests", label: "Client requests", also: (p) => p.startsWith("/work/services") },
      { to: "/work/goals", label: "Goals" },
      { to: "/work/workload", label: "Workload" },
    ],
  },
  { to: "/collab", label: "Collaboration", icon: MessagesSquare, pillar: "collab", tone: "text-collab", color: "var(--collab)", hint: "Threads, channels, decisions" },
  {
    to: "/finance",
    label: "Finance",
    icon: Banknote,
    pillar: "finance",
    tone: "text-finance",
    color: "var(--finance)",
    hint: "Clients, invoices, payments",
    children: [
      { to: "/finance", label: "Overview", exact: true },
      { to: "/finance/invoices", label: "Invoices", also: (p) => p.startsWith("/finance/new") },
      { to: "/finance/quotes", label: "Quotes" },
      { to: "/finance/clients", label: "Clients" },
      { to: "/finance/payments", label: "Payments", also: (p) => p.startsWith("/finance/receipts") },
      { to: "/finance/retainers", label: "Retainers" },
      { to: "/finance/settings", label: "Finance settings" },
    ],
  },
];

export const ADMIN_NAV: NavItem[] = [
  { to: "/settings", label: "Organization", icon: Building2, color: "var(--color-fg-quaternary)" },
  { to: "/settings/audit", label: "Audit log", icon: ScrollText, color: "var(--color-fg-quaternary)" },
  { to: "/settings/preferences", label: "Preferences", icon: Settings, color: "var(--color-fg-quaternary)" },
];

/** The admin pages grouped under one expandable "Settings" item in the sidebar. */
export const SETTINGS_NAV: NavItem = {
  to: "/settings",
  label: "Settings",
  icon: Settings,
  color: "var(--color-fg-quaternary)",
  children: [
    { to: "/settings", label: "Organization", exact: true },
    { to: "/settings/audit", label: "Audit log" },
    { to: "/settings/preferences", label: "Preferences" },
  ],
};

export function isChildActive(pathname: string, c: NavChild) {
  return c.exact ? pathname === c.to : pathname === c.to || pathname.startsWith(`${c.to}/`) || Boolean(c.also?.(pathname));
}

export function isItemActive(pathname: string, item: NavItem) {
  if (item.to === "/") return pathname === "/";
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}
