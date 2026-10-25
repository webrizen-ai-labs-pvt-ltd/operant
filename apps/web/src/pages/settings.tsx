import { can, INDIAN_STATES, isValidGstin, PILLARS, type Pillar, stateOfGstin, type TermKey } from "@operant/core";
import { Avatar, Badge, Button, ButtonGroup, ButtonGroupItem, Card, cn, Field, Input, Label, Select, Textarea, ToggleBase } from "@operant/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ImageUp, Moon, Pencil, Sun, SunMoon, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "../components/app-shell.tsx";
import { api, type Me } from "../lib/api.ts";
import { FINANCE_KEYS, useFinanceSettings } from "../lib/finance.ts";
import { MAIN_NAV } from "../lib/nav.ts";
import { useTheme } from "../lib/theme.ts";

export function OrgSettingsPage({ me }: { me: Me }) {
  const canManage = can(me.org.permissions, "settings", "manage");
  const qc = useQueryClient();
  const [terms, setTerms] = useState(me.settings.terms);
  const [pillars, setPillars] = useState<Pillar[]>(me.settings.enabledPillars);
  const [workWeek, setWorkWeek] = useState<number[]>(me.settings.workWeek);

  // Business details are the ones printed on invoices, receipts and quotes (shared with Finance settings).
  const { data: finance } = useFinanceSettings();
  const [details, setDetails] = useState<BusinessDetails | null>(null);
  useEffect(() => {
    if (finance && !details) {
      const f = finance.settings;
      setDetails({ legalName: f.legalName ?? "", logo: f.logo ?? null, gstin: f.gstin ?? "", stateCode: f.stateCode ?? "", address: f.address ?? "", email: f.email ?? "", phone: f.phone ?? "" });
    }
  }, [finance, details]);
  const gstinValid = !details?.gstin || isValidGstin(details.gstin);
  const [editingName, setEditingName] = useState(false);

  const save = useMutation({
    mutationFn: async () => {
      await api("settings", { method: "PATCH", body: JSON.stringify({ terms, enabledPillars: pillars, workWeek }) });
      if (details) {
        await api("finance/settings", {
          method: "PATCH",
          body: JSON.stringify({
            legalName: details.legalName.trim() || null,
            logo: details.logo,
            gstin: details.gstin || null,
            stateCode: details.stateCode || null,
            address: details.address.trim() || null,
            email: details.email.trim() || null,
            phone: details.phone.trim() || null,
          }),
        });
      }
    },
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: ["me"] }), ...FINANCE_KEYS.map((k) => qc.invalidateQueries({ queryKey: [k] }))]);
      toast.success("Settings saved");
    },
    onError: (e) => toast.error(e.message),
  });

  const togglePillar = (p: Pillar) =>
    setPillars((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6 sm:p-8">
      <PageHeader
        title="Organization"
        description="Name, members and roles are managed in your Webrizen account. Everything else lives here."
      />

      <Card className="p-6">
        <div className="flex items-center gap-4">
          <div className="flex size-14 items-center justify-center rounded-xl bg-brand-solid font-display text-2xl font-bold text-white">
            {me.org.name.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <div className="font-display text-xl font-bold">{me.org.name}</div>
            <div className="font-mono text-xs text-tertiary">{me.org.slug}</div>
          </div>
          <Badge className="ml-auto">{me.settings.currency}</Badge>
        </div>
        {details ? (
          <div className="mt-5 border-t border-secondary pt-4">
            {editingName ? (
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Name on invoices, quotes and receipts" hint="Your registered business name. Leave blank to use the organization name." className="min-w-0 flex-1">
                  <Input
                    value={details.legalName}
                    onChange={(e) => setDetails({ ...details, legalName: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && setEditingName(false)}
                    placeholder={me.org.name}
                    maxLength={200}
                    autoFocus
                  />
                </Field>
                <Button className="mb-6" onClick={() => setEditingName(false)}>
                  <Check /> Done
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-tertiary">Name on invoices, quotes and receipts</div>
                  <div className="truncate font-medium">{details.legalName.trim() || me.org.name}</div>
                </div>
                {canManage ? (
                  <Button size="sm" variant="secondary" onClick={() => setEditingName(true)}>
                    <Pencil /> Edit
                  </Button>
                ) : null}
              </div>
            )}
            <p className="mt-2 text-xs text-tertiary">The organization name above comes from your Webrizen account. Changes here are saved with Save changes.</p>
          </div>
        ) : null}
      </Card>

      {details ? <BusinessDetailsCard details={details} onChange={setDetails} canManage={canManage} gstinValid={gstinValid} /> : null}

      <Card className="p-6">
        <h2 className="text-lg font-bold">Pillars</h2>
        <p className="mt-1 text-sm text-tertiary">Turn off the parts of Operant your team doesn't use.</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {PILLARS.map((p) => {
            const nav = MAIN_NAV.find((n) => n.pillar === p)!;
            const on = pillars.includes(p);
            return (
              <button
                key={p}
                type="button"
                disabled={!canManage}
                onClick={() => togglePillar(p)}
                aria-pressed={on}
                className={cn(
                  "flex items-center gap-3 rounded-xl bg-primary px-4 py-3 text-left text-sm shadow-xs ring-1 ring-inset transition",
                  on ? "ring-primary" : "ring-secondary opacity-70 hover:opacity-100",
                )}
              >
                <nav.icon className={cn("size-4", nav.tone)} />
                <span className="flex-1 font-medium">{nav.label}</span>
                <ToggleBase isSelected={on} isDisabled={!canManage} />
              </button>
            );
          })}
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-lg font-bold">Working days</h2>
        <p className="mt-1 text-sm text-tertiary">Leave only counts these days. Holidays are set in People → Leave.</p>
        <ButtonGroup
          className="mt-4"
          selectionMode="multiple"
          disallowEmptySelection
          isDisabled={!canManage}
          aria-label="Working days"
          selectedKeys={new Set(workWeek.map(String))}
          onSelectionChange={(keys) => setWorkWeek([...keys].map(Number).sort())}
        >
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label, i) => (
            <ButtonGroupItem key={label} id={String(i + 1)} className="selected:bg-brand-primary selected:text-brand-secondary">
              {label}
            </ButtonGroupItem>
          ))}
        </ButtonGroup>
      </Card>

      <Card className="p-6">
        <h2 className="text-lg font-bold">Your words</h2>
        <p className="mt-1 text-sm text-tertiary">
          Rename things to match your industry, for example "Project" to "Case" or "Job".
        </p>
        <div className="mt-4 space-y-3">
          {(Object.keys(terms) as TermKey[]).map((k) => (
            <div key={k} className="grid grid-cols-[100px_1fr_1fr] items-center gap-3">
              <Label className="capitalize text-tertiary">{k}</Label>
              <Input
                aria-label={`${k} singular`}
                value={terms[k].one}
                disabled={!canManage}
                maxLength={40}
                onChange={(e) => setTerms({ ...terms, [k]: { ...terms[k], one: e.target.value } })}
              />
              <Input
                aria-label={`${k} plural`}
                value={terms[k].many}
                disabled={!canManage}
                maxLength={40}
                onChange={(e) => setTerms({ ...terms, [k]: { ...terms[k], many: e.target.value } })}
              />
            </div>
          ))}
        </div>
      </Card>

      {canManage ? (
        <div className="flex justify-end">
          <Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending || !gstinValid}>
            {save.isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-tertiary">You need the settings permission to change these.</p>
      )}
    </div>
  );
}

interface BusinessDetails {
  /** The business name printed on documents; blank uses the organization name. */
  legalName: string;
  /** Data URL, or null for no logo. */
  logo: string | null;
  gstin: string;
  stateCode: string;
  address: string;
  email: string;
  phone: string;
}

/** GST number, address and contact details: printed on every invoice, receipt and quote. */
function BusinessDetailsCard({
  details,
  onChange,
  canManage,
  gstinValid,
}: {
  details: BusinessDetails;
  onChange: (d: BusinessDetails) => void;
  canManage: boolean;
  gstinValid: boolean;
}) {
  const set = (k: Exclude<keyof BusinessDetails, "logo" | "legalName">, v: string) => {
    const next = { ...details, [k]: v };
    // A GSTIN's first two digits are the state.
    if (k === "gstin" && v && isValidGstin(v)) next.stateCode = stateOfGstin(v);
    onChange(next);
  };
  return (
    <Card className="p-6">
      <h2 className="text-lg font-bold">Business details</h2>
      <p className="mt-1 text-sm text-tertiary">Printed on your invoices, receipts and quotes. Also editable in Finance settings.</p>
      <LogoField logo={details.logo} onChange={(logo) => onChange({ ...details, logo })} canManage={canManage} />
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field
          label="GST number (optional)"
          error={gstinValid ? null : "That GST number isn't valid"}
          hint={details.gstin && gstinValid ? INDIAN_STATES[stateOfGstin(details.gstin)] : "Leave blank if you aren't GST-registered. Invoices then go out without GST."}
        >
          <Input
            value={details.gstin}
            onChange={(e) => set("gstin", e.target.value.toUpperCase().replace(/\s/g, "").slice(0, 15))}
            disabled={!canManage}
            className="font-mono"
            placeholder="27AAPFU0939F1ZV"
          />
        </Field>
        <Field label="State" hint="Taken from your GST number when set">
          <Select value={details.stateCode} onChange={(e) => set("stateCode", e.target.value)} disabled={!canManage || Boolean(details.gstin && gstinValid)}>
            <option value="">Choose your state</option>
            {Object.entries(INDIAN_STATES).map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Address" className="sm:col-span-2">
          <Textarea value={details.address} onChange={(e) => set("address", e.target.value)} disabled={!canManage} className="min-h-16" maxLength={500} placeholder="Street, city, PIN code" />
        </Field>
        <Field label="Contact email" hint="Shown on invoices; client replies come here">
          <Input type="email" value={details.email} onChange={(e) => set("email", e.target.value)} disabled={!canManage} maxLength={254} />
        </Field>
        <Field label="Contact phone">
          <Input type="tel" value={details.phone} onChange={(e) => set("phone", e.target.value)} disabled={!canManage} maxLength={32} />
        </Field>
      </div>
    </Card>
  );
}

/** Largest logo we keep, as base64 characters (the server allows a little more). */
const MAX_LOGO_CHARS = 380_000;

/**
 * Shrink an image to fit 600 × 240 (plenty for a document header) and encode it as PNG,
 * or WebP when the PNG would be too large. Returns null if it can't be made small enough.
 */
async function prepareLogo(file: File): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    // onload rather than decode(): decode() never settles for detached images in some browsers.
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });
    const scale = Math.min(1, 600 / img.naturalWidth, 240 / img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const [type, quality] of [["image/png", undefined], ["image/webp", 0.9], ["image/webp", 0.75]] as const) {
      const data = canvas.toDataURL(type, quality);
      if (data.startsWith(`data:${type}`) && data.length <= MAX_LOGO_CHARS) return data;
    }
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function LogoField({ logo, onChange, canManage }: { logo: string | null; onChange: (logo: string | null) => void; canManage: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      toast.error("Upload a PNG, JPEG or WebP image");
      return;
    }
    try {
      const data = await prepareLogo(file);
      if (data) onChange(data);
      else toast.error("That image is too detailed to use as a logo. Try a simpler or smaller one.");
    } catch {
      toast.error("Couldn't read that image");
    }
  };
  return (
    <div className="mt-4 flex flex-wrap items-center gap-4">
      <div className="flex h-20 w-48 items-center justify-center rounded-xl bg-white p-2 ring-1 ring-secondary">
        {logo ? <img src={logo} alt="Company logo" className="max-h-full max-w-full object-contain" /> : <span className="text-xs text-[#8a8178]">No logo</span>}
      </div>
      <div className="space-y-2">
        <div className="text-sm font-medium text-secondary">Company logo</div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" disabled={!canManage} onClick={() => input.current?.click()}>
            <ImageUp /> {logo ? "Replace" : "Upload logo"}
          </Button>
          {logo ? (
            <Button size="sm" variant="ghost" disabled={!canManage} onClick={() => onChange(null)}>
              <Trash2 /> Remove
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-tertiary">PNG, JPEG or WebP. A wide logo on a transparent or white background prints best.</p>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}

interface AuditEvent {
  id: string;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
  actorName: string | null;
  actorImage: string | null;
}

export function AuditPage({ me }: { me: Me }) {
  const allowed = can(me.org.permissions, "audit", "read");
  const [older, setOlder] = useState<AuditEvent[]>([]);
  const [area, setArea] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["audit"],
    queryFn: () => api<{ events: AuditEvent[] }>("audit"),
    enabled: allowed,
  });
  const all = [...(data?.events ?? []), ...older];
  const events = area ? all.filter((e) => areaOf(e) === area) : all;
  const days = new Map<string, AuditEvent[]>();
  for (const e of events) {
    const key = new Date(e.createdAt).toDateString();
    days.set(key, [...(days.get(key) ?? []), e]);
  }

  const loadMore = async () => {
    const last = all.at(-1);
    if (!last) return;
    setLoadingMore(true);
    try {
      const r = await api<{ events: AuditEvent[] }>(`audit?before=${encodeURIComponent(new Date(last.createdAt).toISOString())}`);
      setOlder((o) => [...o, ...r.events]);
      if (r.events.length < 50) setExhausted(true);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="mx-auto space-y-6 p-6 sm:p-8">
      <PageHeader title="Audit log" description="Who did what, and when. Only admins can see this." />
      {allowed ? (
        <div className="flex flex-wrap gap-1.5">
          {AUDIT_AREAS.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={() => setArea(a.key)}
              className={cn(
                "inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[13px] transition-colors",
                area === a.key ? "border-primary bg-tertiary text-primary" : "border-secondary text-tertiary hover:bg-secondary hover:text-primary",
              )}
            >
              <span className="size-2 rounded-full" style={{ background: a.color }} />
              {a.label}
            </button>
          ))}
        </div>
      ) : null}
      {!allowed ? (
        <Card>
          <p className="p-6 text-sm text-tertiary">You don't have access to the audit log.</p>
        </Card>
      ) : null}
      {isLoading ? <p className="text-sm text-tertiary">Loading…</p> : null}
      {data && events.length === 0 ? (
        <Card>
          <p className="p-6 text-sm text-tertiary">Nothing here yet. Changes across Operant show up as they happen.</p>
        </Card>
      ) : null}
      {[...days].map(([day, list]) => (
        <section key={day} className="rise">
          <h2 className="eyebrow mb-2">{dayLabel(day)}</h2>
          <Card>
            <ol className="divide-y divide-border-secondary">
              {list.map((e) => {
                const color = AUDIT_AREAS.find((a) => a.key === areaOf(e))?.color ?? "var(--color-text-tertiary)";
                return (
                  <li key={e.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                    <span className="relative">
                      <Avatar name={e.actorName ?? "Operant"} src={e.actorImage} className="size-8 text-[10px]" />
                      <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-bg-primary" style={{ background: color }} />
                    </span>
                    <p className="min-w-0 flex-1 text-tertiary">
                      <span className="font-medium text-primary">{e.actorName ?? (e.actorId ? "Someone" : "Operant")}</span> {sentence(e)}
                    </p>
                    <code className="hidden rounded bg-secondary px-1.5 py-0.5 font-mono text-[10.5px] text-quaternary md:inline">{e.action}</code>
                    <span className="w-16 shrink-0 text-right font-mono text-[11px] text-tertiary">
                      {new Date(e.createdAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
                    </span>
                  </li>
                );
              })}
            </ol>
          </Card>
        </section>
      ))}
      {allowed && data && data.events.length >= 50 && !exhausted ? (
        <div className="flex justify-center">
          <Button variant="secondary" disabled={loadingMore} onClick={loadMore}>
            {loadingMore ? "Loading…" : "Load older"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

const AUDIT_AREAS = [
  { key: "", label: "Everything", color: "var(--color-brand-600)" },
  { key: "people", label: "People", color: "var(--people)" },
  { key: "work", label: "Work", color: "var(--work)" },
  { key: "collab", label: "Collaboration", color: "var(--collab)" },
  { key: "finance", label: "Finance", color: "var(--finance)" },
  { key: "settings", label: "Settings", color: "var(--color-text-tertiary)" },
];

const AREA_BY_ENTITY: Record<string, string> = {
  employee: "people", department: "people", team: "people", leave: "people", holiday: "people", onboarding: "people", document: "people",
  project: "work", task: "work", milestone: "work", goal: "work", stage: "work",
  channel: "collab", message: "collab", decision: "collab", comment: "collab",
  invoice: "finance", quote: "finance", credit_note: "finance", payment: "finance", client: "finance", retainer: "finance", item: "finance", tax_rate: "finance",
};

function areaOf(e: AuditEvent) {
  const entity = e.action.split(".")[0] ?? "";
  return AREA_BY_ENTITY[entity] ?? AREA_BY_ENTITY[e.targetType ?? ""] ?? "settings";
}

const VERBS: Record<string, string> = {
  created: "created", updated: "updated", deleted: "deleted", archived: "archived", issued: "issued", recorded: "recorded",
  completed: "completed", approved: "approved", rejected: "declined", cancelled: "cancelled", voided: "voided", sent: "sent",
  started: "started", marked: "recorded", uploaded: "uploaded", offboarded: "offboarded", imported: "imported", accepted: "accepted", declined: "declined",
};

/** "invoice.issued" + metadata → "issued invoice INV/26-27/0004" */
function sentence(e: AuditEvent) {
  const [entity = "", verb = ""] = e.action.split(".");
  const m = e.metadata ?? {};
  const label = (m.number ?? m.name ?? m.title ?? m.milestone ?? m.fileName) as string | undefined;
  const thing = entity.replace(/_/g, " ");
  const v = VERBS[verb] ?? verb.replace(/_/g, " ");
  return (
    <>
      {v} {label ? <>{thing} <span className="text-primary">{String(label)}</span></> : `${/^[aeiou]/.test(thing) ? "an" : "a"} ${thing}`}
    </>
  );
}

function dayLabel(day: string) {
  const d = new Date(day);
  const today = new Date();
  const yest = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
}

export function PreferencesPage() {
  const [pref, setPref] = useTheme();
  const options = [
    { key: "dark", label: "Dark", icon: Moon, preview: "bg-[#0c0e12]" },
    { key: "light", label: "Light", icon: Sun, preview: "bg-white" },
    { key: "system", label: "Match system", icon: SunMoon, preview: "bg-[linear-gradient(135deg,#ffffff_50%,#0c0e12_50%)]" },
  ] as const;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6 sm:p-8">
      <PageHeader title="Preferences" description="These apply to this device only." />
      <Card className="p-6">
        <h2 className="text-lg font-bold">Theme</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setPref(o.key)}
              aria-pressed={pref === o.key}
              className={cn(
                "overflow-hidden rounded-lg border text-left transition-colors",
                pref === o.key ? "border-brand" : "border-secondary hover:border-primary",
              )}
            >
              <div className={cn("h-20 border-b border-secondary", o.preview)} />
              <div className="flex items-center gap-2 px-3 py-2 text-sm">
                <o.icon className="size-4 text-tertiary" />
                {o.label}
              </div>
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}
