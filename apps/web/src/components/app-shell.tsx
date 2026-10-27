import { can } from "@operant/core";
import {
  Avatar,
  Badge,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Kbd,
  Logo,
  PageHero,
} from "@operant/ui";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  ArrowLeftRight,
  BookOpen,
  CalendarPlus,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  FilePlus2,
  Hash,
  House,
  ListPlus,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  UserPlus,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { type Me, signIn, signOut } from "../lib/api.ts";
import { useDetailCrumb } from "../lib/breadcrumbs.ts";
import { useChannels } from "../lib/collab.ts";
import { useHome } from "../lib/home.ts";
import { useRequestsSummary } from "../lib/portal.ts";
import { HELP_NAV, isChildActive, isItemActive, MAIN_NAV, type NavItem, SETTINGS_NAV } from "../lib/nav.ts";
import { useLiveEvents } from "../lib/realtime.ts";
import { useTheme } from "../lib/theme.ts";
import { CommandPalette, useCommandPalette } from "./command-palette.tsx";
import { NotificationBell } from "./notification-bell.tsx";

/* ---------------- Sidebar ---------------- */

const itemBase =
  "group relative flex w-full items-center gap-3 rounded-md px-3 text-left outline-focus-ring transition duration-100 ease-linear select-none focus-visible:outline-2 focus-visible:outline-offset-2";

function Count({ n, tone }: { n?: number; tone?: "brand" }) {
  if (!n) return null;
  return (
    <Badge tone={tone ?? "neutral"} pill className="px-1.5 py-0 text-[11px]">
      {n > 99 ? "99+" : n}
    </Badge>
  );
}

/** One sidebar entry; with children it expands to show the section's pages. */
function SidebarItem({
  item,
  counts,
  onNavigate,
}: {
  item: NavItem;
  counts: Record<string, { n?: number; tone?: "brand" }>;
  onNavigate?: () => void;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const active = isItemActive(pathname, item);
  const [open, setOpen] = useState(active);
  useEffect(() => {
    if (active) setOpen(true);
  }, [active]);

  const icon = (
    <item.icon
      aria-hidden
      className={cn("size-5 shrink-0 transition-colors", active ? "" : "text-fg-quaternary group-hover:text-fg-quaternary_hover")}
      style={active ? { color: item.color } : undefined}
    />
  );
  const label = <span className={cn("flex-1 truncate text-sm font-semibold", active ? "text-primary" : "text-secondary group-hover:text-secondary_hover")}>{item.label}</span>;

  if (!item.children) {
    return (
      <Link to={item.to} onClick={onNavigate} className={cn(itemBase, "h-10", active ? "bg-secondary" : "hover:bg-primary_hover")}>
        {icon}
        {label}
        <Count {...counts[item.to]} />
      </Link>
    );
  }

  // Sum of the children's counts, shown while the group is collapsed.
  const total = item.children.reduce((n, c) => n + (counts[c.to]?.n ?? 0), 0);
  return (
    <div>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={cn(itemBase, "h-10 hover:bg-primary_hover", active && !open && "bg-secondary")}>
        {icon}
        {label}
        {!open ? <Count n={total} /> : null}
        <ChevronDown className={cn("size-4 shrink-0 text-fg-quaternary transition-transform duration-150", open ? "rotate-0" : "-rotate-90")} />
      </button>
      {open ? (
        <ul className="relative mt-0.5 mb-1 space-y-0.5 pl-[22px] before:absolute before:top-1 before:bottom-1 before:left-[22px] before:w-px before:bg-border-secondary">
          {item.children.map((c) => {
            const on = isChildActive(pathname, c);
            return (
              <li key={c.to}>
                <Link
                  to={c.to}
                  onClick={onNavigate}
                  aria-current={on ? "page" : undefined}
                  className={cn(
                    itemBase,
                    "ml-3 h-9 w-[calc(100%-12px)] text-sm font-semibold",
                    on ? "bg-secondary text-primary" : "text-tertiary hover:bg-primary_hover hover:text-secondary",
                  )}
                >
                  {on ? <span className="absolute -left-[15px] top-2 bottom-2 w-0.5 rounded-full" style={{ background: item.color }} /> : null}
                  <span className="flex-1 truncate">{c.label}</span>
                  <Count {...counts[c.to]} />
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

const THEMES = [
  { key: "light", label: "Light", icon: Sun },
  { key: "dark", label: "Dark", icon: Moon },
  { key: "system", label: "System", icon: Monitor },
] as const;

/** The signed-in person at the foot of the sidebar; opens the account menu. */
function AccountMenu({ me }: { me: Me }) {
  const [pref, setPref] = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="group flex w-full items-center gap-3 rounded-xl p-2 text-left outline-focus-ring transition hover:bg-primary_hover focus-visible:outline-2 data-[state=open]:bg-primary_hover"
        >
          <span className="relative">
            <Avatar name={me.user.name} src={me.user.image} className="size-10" />
            <span className="absolute right-1 bottom-1 size-2.5 rounded-full bg-fg-success-secondary ring-[1.5px] ring-bg-primary" />
          </span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-sm font-semibold text-primary">{me.user.name}</span>
            <span className="block truncate text-sm text-tertiary">{me.user.email || me.org.name}</span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-fg-quaternary group-hover:text-fg-quaternary_hover" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" sideOffset={8} className="w-[248px]">
        <div className="flex items-center gap-3 px-4 py-3">
          <Avatar name={me.user.name} src={me.user.image} className="size-10" />
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-semibold text-primary">{me.user.name}</div>
            <div className="truncate text-sm text-tertiary">{me.user.email}</div>
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Organization</DropdownMenuLabel>
        <div className="mx-1.5 mb-1 flex items-center gap-2.5 rounded-md px-2.5 py-2">
          <span className="flex size-6 items-center justify-center rounded-md bg-brand-solid text-[11px] font-bold text-white shadow-xs-skeuomorphic">
            {me.org.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-sm font-semibold text-secondary">{me.org.name}</span>
            <span className="block truncate text-xs capitalize text-tertiary">{me.org.roleName ?? (me.org.roles.join(", ") || "member")}</span>
          </span>
        </div>
        {me.edition === "cloud" ? (
          <DropdownMenuItem onSelect={() => signIn("/")}>
            <ArrowLeftRight />
            Switch organization
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        {THEMES.map((t) => (
          <DropdownMenuItem
            key={t.key}
            onSelect={(e) => {
              e.preventDefault();
              setPref(t.key);
            }}
          >
            <t.icon />
            <span className="flex-1">{t.label}</span>
            {pref === t.key ? <Check className="!text-fg-brand-primary" /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/help">
            <BookOpen />
            Help and guides
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/settings/preferences">
            <Settings />
            Preferences
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Sidebar({ me, onNavigate, onSearch }: { me: Me; onNavigate?: () => void; onSearch: () => void }) {
  const enabled = new Set(me.settings.enabledPillars);
  const { data: home } = useHome();
  const { data: chats } = useChannels();
  const unreadChats = (chats?.channels ?? []).reduce((n, c) => n + c.unread, 0);
  // New client requests and unread client messages from the portal.
  const { data: requests } = useRequestsSummary(can(me.org.permissions, "client", "read") || can(me.org.permissions, "project", "create"));
  const attention = (kind: string) => home?.attention.find((a) => a.kind === kind)?.count;
  const counts: Record<string, { n?: number; tone?: "brand" }> = {
    "/": { n: home?.counts.attention, tone: "brand" },
    "/work": { n: home ? home.day.buckets.overdue + home.day.buckets.today : undefined },
    "/collab": { n: unreadChats },
    "/people/leave": { n: attention("leave") },
    "/people/onboarding": { n: attention("onboarding") },
    "/finance/invoices": { n: (attention("overdue_invoices") ?? 0) + (attention("draft_invoices") ?? 0) },
    "/work/requests": { n: requests ? requests.new + requests.unread : undefined, tone: "brand" },
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 pt-5 pb-4">
        <span className="flex size-9 items-center justify-center rounded-lg bg-brand-solid text-white shadow-xs-skeuomorphic">
          <Logo className="size-7" />
        </span>
        <div className="flex flex-col -space-y-1">
          <span className="font-bold tracking-tight text-primary">Operant</span>
        <span className="text-xs text-fg-tertiary">By Webrizen AI Labs.</span>
        </div>
      </div>

      <div className="px-4 pb-2">
        <button
          type="button"
          onClick={onSearch}
          className="flex h-10 w-full items-center gap-2 rounded-lg bg-primary px-3 text-md text-placeholder shadow-xs ring-1 ring-primary outline-hidden transition ring-inset hover:bg-primary_hover focus-visible:ring-2 focus-visible:ring-brand"
        >
          <Search className="size-5 text-fg-quaternary" />
          <span className="flex-1 text-left">Search</span>
          <Kbd>Ctrl K</Kbd>
        </button>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-4 py-2" aria-label="Main">
        {MAIN_NAV.filter((n) => !n.pillar || enabled.has(n.pillar)).map((n) => (
          <SidebarItem key={n.to} item={n} counts={counts} onNavigate={onNavigate} />
        ))}
      </nav>

      <div className="space-y-2 px-4 pb-4">
        <SidebarItem item={HELP_NAV} counts={counts} onNavigate={onNavigate} />
        <SidebarItem item={SETTINGS_NAV} counts={counts} onNavigate={onNavigate} />
        <div className="border-t border-secondary pt-3">
          <AccountMenu me={me} />
        </div>
      </div>
    </div>
  );
}

/* ---------------- Top bar ---------------- */

function Breadcrumbs() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const detail = useDetailCrumb();
  const crumbs: { label: string; to?: string }[] = [];

  const item = [...MAIN_NAV.slice(1), SETTINGS_NAV, HELP_NAV].find((n) => isItemActive(pathname, n));
  if (item) {
    crumbs.push({ label: item.label, to: item.to });
    const child = item.children?.find((c) => isChildActive(pathname, c));
    if (child && child.to !== item.to) crumbs.push({ label: child.label, to: child.to });
    else if (child && child.to === item.to && !detail) crumbs.push({ label: child.label });
    if (pathname.startsWith("/finance/new") && !detail) crumbs.push({ label: "New" });
  } else if (pathname === "/") {
    crumbs.push({ label: "Dashboard" });
  }
  if (detail) crumbs.push({ label: detail });

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5">
        <li>
          <Link to="/" aria-label="Home" className="flex rounded-md p-1 text-fg-quaternary transition hover:bg-primary_hover hover:text-fg-quaternary_hover">
            <House className="size-5" />
          </Link>
        </li>
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={`${c.label}-${i}`} className={cn("flex min-w-0 items-center gap-1.5", !last && "max-sm:hidden")}>
              <ChevronRight className="size-4 shrink-0 text-fg-quaternary" aria-hidden />
              {c.to && !last ? (
                <Link to={c.to} className="truncate rounded-md px-1.5 py-1 text-sm font-semibold text-quaternary transition hover:bg-primary_hover hover:text-tertiary">
                  {c.label}
                </Link>
              ) : (
                <span aria-current="page" className="truncate rounded-md bg-primary_hover px-2 py-1 text-sm font-semibold text-secondary">
                  {c.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** "New …" menu in the header: the most common things to create, wherever you are. */
function CreateMenu({ me }: { me: Me }) {
  const navigate = useNavigate();
  const p = me.org.permissions;
  const items = [
    { show: can(p, "task", "create"), icon: ListPlus, label: "Task", hint: "Add to My work", go: () => navigate({ to: "/work" }) },
    { show: can(p, "invoice", "create"), icon: FilePlus2, label: "Invoice", hint: "GST invoice", go: () => navigate({ to: "/finance/new", search: { kind: "invoice" } }) },
    { show: can(p, "leave", "request"), icon: CalendarPlus, label: "Leave request", hint: "Time off", go: () => navigate({ to: "/people/leave" }) },
    { show: can(p, "employee", "create"), icon: UserPlus, label: "Employee", hint: "Add to directory", go: () => navigate({ to: "/people/directory", search: { add: true } }) },
    { show: can(p, "channel", "create"), icon: Hash, label: "Channel", hint: "Start a conversation", go: () => navigate({ to: "/collab" }) },
  ].filter((i) => i.show);
  if (!items.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="primary" size="md">
          <Plus /> <span className="hidden sm:inline">New</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Create</DropdownMenuLabel>
        {items.map((i) => (
          <DropdownMenuItem key={i.label} onSelect={i.go}>
            <i.icon />
            <span className="flex-1">{i.label}</span>
            <span className="text-xs font-medium text-quaternary">{i.hint}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({ me }: { me: Me }) {
  useLiveEvents();
  const [paletteOpen, setPaletteOpen] = useCommandPalette();
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => setMobileOpen(false), [pathname]);

  return (
    <div className="flex h-dvh overflow-hidden bg-secondary">
      <aside className="hidden w-70 shrink-0 border-r border-secondary bg-primary lg:block">
        <Sidebar me={me} onSearch={() => setPaletteOpen(true)} />
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-overlay/70 backdrop-blur-[6px]" onClick={() => setMobileOpen(false)} />
          <aside className="relative h-full w-74 max-w-[85vw] bg-primary shadow-xl">
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setMobileOpen(false)}
              className="absolute top-4 -right-12 flex size-10 items-center justify-center rounded-lg text-white/80 hover:text-white"
            >
              <X className="size-6" />
            </button>
            <Sidebar me={me} onNavigate={() => setMobileOpen(false)} onSearch={() => setPaletteOpen(true)} />
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-secondary bg-primary px-4 sm:px-8">
          <Button variant="ghost" size="icon" className="-ml-2 lg:hidden" aria-label="Open menu" onClick={() => setMobileOpen(true)}>
            <Menu />
          </Button>
          <Breadcrumbs />
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Search" onClick={() => setPaletteOpen(true)}>
              <Search />
            </Button>
            <NotificationBell />
            <CreateMenu me={me} />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

/** Page title block for list and settings pages. */
export function PageHeader({ title, description, actions, eyebrow, children }: { title: string; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode; children?: ReactNode }) {
  return (
    <PageHero eyebrow={eyebrow} title={title} summary={description} actions={actions}>
      {children}
    </PageHero>
  );
}
