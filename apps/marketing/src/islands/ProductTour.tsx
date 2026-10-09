import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

/*
 * A live, HTML-built look at the product (not a screenshot): crisp at any size,
 * themable, and cheap to load. It cycles through the areas until someone picks one,
 * and pauses while off screen or when the visitor prefers less motion.
 */

const TABS = [
  { key: "home", label: "Home", color: "var(--brand)" },
  { key: "work", label: "Work", color: "var(--work)" },
  { key: "finance", label: "Finance", color: "var(--finance)" },
  { key: "chat", label: "Chat", color: "var(--collab)" },
  { key: "portal", label: "Client portal", color: "var(--people)" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const Dot = ({ c }: { c: string }) => <span className="inline-block size-2" style={{ background: c }} />;
const Pill = ({ children, tone = "var(--ink-3)" }: { children: React.ReactNode; tone?: string }) => (
  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold" style={{ color: tone, background: `color-mix(in oklab, ${tone} 14%, transparent)` }}>
    {children}
  </span>
);
const Card = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div className={` border border-line bg-card p-3 ${className}`}>{children}</div>
);
const Avatar = ({ n, c }: { n: string; c: string }) => (
  <span className="flex size-6 shrink-0 items-center justify-center text-[9px] font-bold text-white" style={{ background: c }}>
    {n}
  </span>
);

function Home() {
  const bars = [38, 52, 44, 61, 58, 72, 66, 80, 74, 88, 82, 94];
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="space-y-3 sm:col-span-2">
        <div className="pop">
          <div className="text-[11px] text-ink-3">Monday, 12 October</div>
          <div className="text-lg font-semibold tracking-tight">Good morning, Meera</div>
          <div className="text-[11px] text-ink-3">
            You have <b className="text-brand-ink">3 tasks</b> due today and <b className="text-ink">4 things</b> waiting for you.
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            ["Open tasks", "42", "6 overdue"],
            ["Collected", "₹4.8L", "+18% vs last month"],
            ["Outstanding", "₹2.1L", "₹64K overdue"],
          ].map(([k, v, s], i) => (
            <Card key={k} className="pop" >
              <div style={{ "--i": i } as React.CSSProperties} className="text-[10px] text-ink-3">
                {k}
              </div>
              <div className="mt-1 font-mono text-base font-semibold">{v}</div>
              <div className="text-[10px] text-ink-3">{s}</div>
            </Card>
          ))}
        </div>
        <Card>
          <div className="mb-2 flex items-center justify-between text-[11px]">
            <span className="font-semibold">Billed vs collected</span>
            <span className="flex gap-2 text-ink-3">
              <span className="flex items-center gap-1">
                <Dot c="var(--finance)" /> Billed
              </span>
              <span className="flex items-center gap-1">
                <Dot c="var(--collab)" /> Collected
              </span>
            </span>
          </div>
          <div className="flex h-24 items-end gap-1.5">
            {bars.map((h, i) => (
              <div key={i} className="flex h-full flex-1 items-end gap-0.5">
                <span className="pop w-full" style={{ height: `${h}%`, background: "var(--finance)", "--i": i } as React.CSSProperties} />
                <span className="pop w-full" style={{ height: `${h * 0.82}%`, background: "var(--collab)", "--i": i } as React.CSSProperties} />
              </div>
            ))}
          </div>
        </Card>
      </div>
      <Card className="space-y-2">
        <div className="text-[11px] font-semibold">Needs your attention</div>
        {[
          ["3 leave requests to review", "var(--people)"],
          ["2 invoices are overdue", "var(--brand)"],
          ["New client request", "var(--collab)"],
          ["1 draft invoice to send", "var(--finance)"],
        ].map(([t, c], i) => (
          <div key={t} className="pop flex items-center gap-2 border border-line p-2 text-[11px]" style={{ "--i": i } as React.CSSProperties}>
            <span className="size-6 shrink-0" style={{ background: `color-mix(in oklab, ${c} 18%, transparent)` }} />
            {t}
          </div>
        ))}
      </Card>
    </div>
  );
}

function Work() {
  const cols = [
    { name: "To do", tasks: [["GST-14", "Reconcile GSTR-2B", "AR"], ["GST-15", "Collect purchase invoices", "MK"]] },
    { name: "In progress", tasks: [["AUD-7", "Fixed asset verification", "SI"], ["AUD-9", "Bank confirmations", "RJ"]] },
    { name: "Review", tasks: [["ITR-22", "Review deductions", "MP"]] },
    { name: "Done", tasks: [["GST-12", "File GSTR-1", "AR"], ["INC-3", "Name approval", "KN"]] },
  ];
  const colors = ["#f46036", "#3e6fd6", "#179a6d", "#b8860b", "#8b5cf6", "#0ea5e9"];
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="flex size-7 items-center justify-center bg-brand font-mono text-[10px] font-bold text-white">GST</span>
        <div>
          <div className="text-sm font-semibold">Monthly GST returns · Kaveri Foods</div>
          <div className="text-[10px] text-ink-3">68% done · due 20 Oct</div>
        </div>
        <div className="ml-auto flex gap-1">
          {["Board", "List", "Calendar", "Milestones", "Client"].map((v, i) => (
            <span key={v} className={` px-2 py-1 text-[10px] font-semibold ${i === 0 ? "bg-paper-2 text-ink" : "text-ink-3"}`}>
              {v}
            </span>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {cols.map((c, ci) => (
          <div key={c.name} className=" bg-paper-2 p-2">
            <div className="mb-2 flex items-center justify-between text-[10px] font-semibold text-ink-2">
              {c.name} <span className="text-ink-3">{c.tasks.length}</span>
            </div>
            <div className="space-y-2">
              {c.tasks.map(([k, t, who], i) => (
                <div key={k} className="pop border border-line bg-card p-2" style={{ "--i": ci * 2 + i } as React.CSSProperties}>
                  <div className="font-mono text-[9px] text-ink-3">{k}</div>
                  <div className={`mt-0.5 text-[11px] font-medium ${c.name === "Done" ? "text-ink-3 line-through" : ""}`}>{t}</div>
                  <div className="mt-2 flex items-center justify-between">
                    <Pill tone={c.name === "Done" ? "var(--people)" : ci === 1 ? "var(--collab)" : "var(--ink-3)"}>{c.name === "Done" ? "Done" : `${12 + ci + i} Oct`}</Pill>
                    <Avatar n={who!} c={colors[(ci + i) % colors.length]!} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Finance() {
  return (
    <div className="grid gap-3 sm:grid-cols-[1.25fr_1fr]">
      <Card className="pop">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs font-semibold">Mehta &amp; Co</div>
            <div className="text-[10px] text-ink-3">GSTIN 27AAKFM4821Q1ZE</div>
          </div>
          <div className="text-right">
            <div className="text-[11px] font-bold tracking-wide">TAX INVOICE</div>
            <div className="font-mono text-[10px] text-ink-3">INV/26-27/0042</div>
          </div>
        </div>
        <div className="mt-3 border-t border-line pt-2 text-[10px]">
          {[
            ["Statutory audit FY 2025-26", "998221", "₹1,20,000"],
            ["Tax audit (Form 3CD)", "998221", "₹35,000"],
          ].map(([d, h, a]) => (
            <div key={d} className="flex justify-between gap-2 py-1">
              <span>
                {d} <span className="text-ink-3">· {h}</span>
              </span>
              <span className="font-mono">{a}</span>
            </div>
          ))}
          <div className="mt-1 space-y-0.5 border-t border-line pt-1 text-ink-3">
            <div className="flex justify-between">
              <span>IGST 18% (Karnataka)</span>
              <span className="font-mono">₹27,900</span>
            </div>
          </div>
          <div className="mt-1 flex justify-between border-t border-line pt-1 text-xs font-semibold">
            <span>Total</span>
            <span className="font-mono">₹1,82,900</span>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <span className="bg-brand text-[#09090b] px-2.5 py-1 text-[10px] font-semibold">Pay online</span>
          <span className="border border-line-2 px-2.5 py-1 text-[10px] font-semibold">Split into instalments</span>
        </div>
      </Card>
      <div className="space-y-3">
        <Card>
          <div className="text-[11px] font-semibold">Instalments · 6 monthly at 12%</div>
          <div className="mt-2 space-y-1.5">
            {[
              ["1", "Nov", "Paid", "var(--people)"],
              ["2", "Dec", "Due", "var(--collab)"],
              ["3", "Jan", "Upcoming", "var(--ink-3)"],
            ].map(([n, m, s, c], i) => (
              <div key={n} className="pop flex items-center gap-2 text-[10px]" style={{ "--i": i } as React.CSSProperties}>
                <span className="w-3 text-ink-3">{n}</span>
                <span className="w-8">{m}</span>
                <span className="font-mono">₹31,543</span>
                <span className="ml-auto">
                  <Pill tone={c}>{s}</Pill>
                </span>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <div className="text-[11px] font-semibold">Owed by age</div>
          <div className="mt-2 flex h-2 overflow-hidden">
            {[
              [46, "#d4a94a"],
              [30, "#c09332"],
              [16, "#a07a24"],
              [8, "#7f5f1a"],
            ].map(([w, c]) => (
              <span key={c} style={{ width: `${w}%`, background: c as string }} className="border-r-2 border-card last:border-0" />
            ))}
          </div>
          <div className="mt-1.5 flex justify-between text-[9px] text-ink-3">
            <span>Not due</span>
            <span>1–30</span>
            <span>31–60</span>
            <span>60+</span>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Chat() {
  const msgs = [
    ["RJ", "#3e6fd6", "Rohit", "Bank confirmations are back from HDFC and ICICI. Uploading to the audit file now."],
    ["MP", "#b8860b", "Meera", "Thanks! @Sneha can you check the Axis one before Thursday?"],
    ["SI", "#179a6d", "Sneha", "On it. Also: we're going with the revised materiality of ₹4L."],
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-[150px_1fr]">
      <div className="hidden space-y-0.5 text-[11px] sm:block">
        {["# general", "# audit", "# gst-desk", "# advisory"].map((c, i) => (
          <div key={c} className={` px-2 py-1 ${i === 1 ? "bg-paper-2 font-semibold" : "text-ink-3"}`}>
            {c}
          </div>
        ))}
      </div>
      <Card className="space-y-3">
        {msgs.map(([n, c, name, t], i) => (
          <div key={i} className={`pop flex gap-2 ${i === 2 ? " p-1.5" : ""}`} style={{ "--i": i * 2, ...(i === 2 ? { background: "color-mix(in oklab, var(--finance) 10%, transparent)" } : {}) } as React.CSSProperties}>
            <Avatar n={n!} c={c!} />
            <div className="min-w-0">
              <div className="text-[10px]">
                <b>{name}</b> <span className="text-ink-3">10:{14 + i}</span>
                {i === 2 ? <span className="ml-1 font-semibold" style={{ color: "var(--finance)" }}>· Decision</span> : null}
              </div>
              <div className="text-[11px] text-ink-2">{t}</div>
              {i === 0 ? (
                <div className="mt-1 flex gap-1">
                  <span className=" border border-line px-1.5 text-[10px]">👍 3</span>
                  <span className=" border border-line px-1.5 text-[10px]">🎉 1</span>
                </div>
              ) : null}
            </div>
          </div>
        ))}
        <div className=" border border-line px-2 py-1.5 text-[11px] text-ink-3">Message #audit</div>
      </Card>
    </div>
  );
}

function Portal() {
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_1.2fr]">
      <div className="space-y-2">
        <div className="text-[10px] text-ink-3">What your client sees</div>
        <div className="text-sm font-semibold">Welcome, Lakshmi</div>
        {[
          ["Review the quote for GST filing", "var(--brand)"],
          ["2 documents needed", "var(--finance)"],
          ["1 invoice to pay · ₹70,800", "var(--collab)"],
        ].map(([t, c], i) => (
          <div key={t} className="pop flex items-center gap-2 border border-line bg-card p-2 text-[11px]" style={{ "--i": i } as React.CSSProperties}>
            <span className="size-5" style={{ background: `color-mix(in oklab, ${c} 20%, transparent)` }} />
            {t}
          </div>
        ))}
      </div>
      <Card className="space-y-2.5">
        <div className="flex items-center justify-between text-[11px]">
          <b>GST return filing</b>
          <Pill tone="var(--collab)">In discussion</Pill>
        </div>
        <div className="flex gap-1">
          {[1, 1, 0, 0].map((on, i) => (
            <span key={i} className="h-1 flex-1" style={{ background: on ? "var(--brand)" : "var(--line)" }} />
          ))}
        </div>
        <div className="flex gap-2">
          <Avatar n="AR" c="#f46036" />
          <div className=" bg-paper-2 px-2.5 py-1.5 text-[11px]">Could you upload September's sales register? I'll send the quote today.</div>
        </div>
        <div className="flex justify-end">
          <div className=" bg-brand px-2.5 py-1.5 text-[11px] text-white">Uploading it now.</div>
        </div>
        <div className="space-y-1 border-t border-line pt-2 text-[10px]">
          <div className="flex justify-between">
            <span>Sales register</span>
            <Pill tone="var(--people)">Accepted</Pill>
          </div>
          <div className="flex justify-between">
            <span>Purchase invoices</span>
            <Pill tone="var(--finance)">Needed</Pill>
          </div>
        </div>
      </Card>
    </div>
  );
}

const PANELS: Record<Tab, () => React.ReactNode> = { home: Home, work: Work, finance: Finance, chat: Chat, portal: Portal };

export default function ProductTour() {
  const [tab, setTab] = useState<Tab>("home");
  const [auto, setAuto] = useState(true);
  const [visible, setVisible] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // Only cycle while on screen, and never for visitors who prefer less motion.
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setVisible(Boolean(e?.isIntersecting)), { threshold: 0.3 });
    if (root.current) io.observe(root.current);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setAuto(false);
    return () => io.disconnect();
  }, []);

  const go = (next: Tab) => {
    const apply = () => flushSync(() => setTab(next));
    // Cross-fade with the View Transitions API where the browser has it.
    type Vt = { ready: Promise<void>; finished: Promise<void>; updateCallbackDone: Promise<void> };
    const doc = document as Document & { startViewTransition?: (cb: () => void) => Vt };
    if (doc.startViewTransition && !document.hidden && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const vt = doc.startViewTransition(apply);
      // The browser skips transitions it can't show (e.g. a hidden tab); that's fine.
      for (const p of [vt.ready, vt.finished, vt.updateCallbackDone]) p.catch(() => {});
    } else apply();
  };

  useEffect(() => {
    if (!auto || !visible) return;
    const id = setTimeout(() => {
      const i = TABS.findIndex((t) => t.key === tab);
      go(TABS[(i + 1) % TABS.length]!.key);
    }, 5200);
    return () => clearTimeout(id);
  }, [auto, visible, tab]);

  const Panel = PANELS[tab];
  return (
    <div ref={root} className="relative">
      <div role="tablist" aria-label="Product areas" className="flex w-full overflow-x-auto border border-b-0 border-line bg-paper [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map((t) => {
          const active = t.key === tab;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={active}
              onClick={() => {
                setAuto(false);
                go(t.key);
              }}
              className={`relative flex shrink-0 items-center gap-2 overflow-hidden border-r border-line px-4 py-2.5 text-sm font-medium transition ${active ? "bg-brand text-[#09090b]" : "text-ink-3 hover:bg-card hover:text-ink"}`}
            >
              <Dot c={t.color} />
              {t.label}
              {active && auto && visible ? <span key={tab} className="absolute bottom-0 left-0 h-0.5 bg-[#09090b]/60" style={{ animation: "tour-progress 5.2s linear forwards" }} /> : null}
            </button>
          );
        })}
      </div>

      <div className="border border-line bg-paper" style={{ viewTransitionName: "tour" }}>
        <div className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
            <span className="flex gap-1.5">
              <i className="size-2.5 bg-[#ff5f57]" />
              <i className="size-2.5 bg-[#febc2e]" />
              <i className="size-2.5 bg-[#28c840]" />
            </span>
            <span className="mx-auto bg-paper-2 px-3 py-0.5 font-mono text-[10px] text-ink-3">{tab === "portal" ? "Client portal · Kaveri Foods" : `Operant · ${TABS.find((t) => t.key === tab)!.label}`}</span>
          </div>
          <div className="flex">
            <aside className="hidden w-36 shrink-0 space-y-0.5 border-r border-line p-3 text-[11px] md:block">
              <div className="mb-3 flex items-center gap-1.5 font-semibold">
                <img src="/logo.png" alt="" className="size-5" /> Operant
              </div>
              {[
                ["Home", "home"],
                ["People", ""],
                ["Work", "work"],
                ["Collaboration", "chat"],
                ["Finance", "finance"],
              ].map(([l, k]) => (
                <div key={l} className={` px-2 py-1 ${k === tab ? "bg-paper-2 font-semibold text-ink" : "text-ink-3"}`}>
                  {l}
                </div>
              ))}
            </aside>
            <div key={tab} className="min-h-[340px] min-w-0 flex-1 p-4 text-ink">
              <Panel />
            </div>
          </div>
        </div>
      </div>
      <style>{`@keyframes tour-progress { from { width: 0 } to { width: 100% } }`}</style>
    </div>
  );
}
