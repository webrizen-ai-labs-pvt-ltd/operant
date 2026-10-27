# Decision log

| # | Date | Decision | Why |
|---|---|---|---|
| D1 | 2026-09-30 | Two editions from one codebase: cloud SaaS + standalone offline | Sell as SaaS; some businesses need on-premise, no-internet use |
| D2 | 2026-09-30 | Cloud identity = Webrizen SSO (OIDC), integrated with `openid-client` | Shared login across Webrizen products; no SDK available to this repo |
| D3 | 2026-09-30 | Cloud data/files/realtime on Supabase | Managed Postgres + storage + realtime without building them |
| D4 | 2026-09-30 | All data goes through our Hono API; the browser only touches Supabase for Realtime (short-lived minted JWT) | The same API must run inside the offline edition |
| D5 | 2026-09-30 | One Drizzle schema for Supabase Postgres and PGlite | No separate offline schema to maintain |
| D6 | 2026-09-30 | Vite React SPA instead of Next.js | Same UI must run in Electron without a Next.js server |
| D7 | 2026-09-30 | Monorepo (pnpm + Turborepo) | Two editions share UI, API and schema |
| D8 | 2026-09-30 | Forge brand: Bricolage Grotesque / Geist / Geist Mono; Obsidian, Ash, Ember, Brass, Patina, Steel, Slag | Approved by the owner |
| D9 | 2026-09-30 | Permissions checked by `resource:action`, never role names | Orgs reshape roles in SSO without code changes |
| D10 | 2026-09-30 | Members removed via SSO webhook are blocked at once, even with a live session | Revocation shouldn't wait for token expiry |
| D10a | 2026-10-28 | Webrizen SSO v2: no webhooks or app tokens. Permissions come from Operant's role keys (mapped in core), and members sync with the signed-in person's token on sign-in and refresh | v2 replaced per-app permissions and the Directory API with app roles and a management API; removals take effect within the 10-minute access token |
| D11 | 2026-09-30 | Deploy with Vercel's Build Output API (one bundled function + static SPA) | Workspace TypeScript packages bundle reliably with esbuild |
| D12 | 2026-09-30 | UUID v7 ids generated in the app | Time-ordered ids; identical behaviour on both database engines |
| D13 | 2026-09-30 | Employees are separate from sign-in accounts (`members`) and linked by work email | HR can add people before they sign in; some staff never need an account |
| D14 | 2026-09-30 | Leave is counted in working days on the server (org work week, non-optional holidays, half days) and checked against the yearly balance, pending included | One source of truth; no over-booking by submitting many requests |
| D15 | 2026-09-30 | Managers approve their direct reports; `leave:approve` approves anyone; nobody approves their own leave | Matches how most Indian SMEs run leave |
| D16 | 2026-09-30 | Onboarding steps live in their own table and, since Phase 2, each also gets a task (`source = onboarding`); ticking either one updates both | Steps show up in My work without changing the checklist |
| D17 | 2026-09-30 | Employee documents: HR (`employee:update`) and the employee only | Documents are usually ID proofs and contracts |
| D18 | 2026-10-01 | Projects have custom stages, each mapped to one of four categories (to do, in progress, review, done); tasks copy the category into `status` | Free-form workflows while reports and My work stay consistent |
| D19 | 2026-10-01 | Board order uses fractional positions | A drag rewrites one row, not the whole column |
| D20 | 2026-10-01 | Assignees are employees (not sign-in accounts); assigning others needs `task:assign`, self-assign doesn't | Matches People; members can pick up work without admin rights |
| D21 | 2026-10-01 | Recurring tasks roll forward on completion (no scheduler) | Works identically in the offline edition |
| D22 | 2026-10-01 | A task can't be completed while its blockers are open | Dependencies are meaningful, not decorative |
| D23 | 2026-10-01 | Projects are visible to everyone with `project:read`; private projects are deferred | Keeps every query simple until there's demand |
| D24 | 2026-10-01 | Chat participants are sign-in accounts (`members`); employees without an account can't chat | Only people who can log in can read or write |
| D25 | 2026-10-01 | Messages are plain text with `@[member:<id>]` mention tokens and a small safe formatting subset (bold, italic, code, links) | No HTML injection risk; same format works offline and in emails |
| D26 | 2026-10-01 | Live updates send ids only; browsers refetch through the API. Cloud: one Supabase Realtime topic per org. Local/offline: in-process bus + Server-Sent Events filtered per connection | One access-control path (the API); private content never travels over the realtime layer |
| D27 | 2026-10-01 | Comment threads attach to records by (type, id); tasks and projects for now, finance records later | Any pillar can add discussion without new tables |
| D28 | 2026-10-01 | Emails only for mentions, DMs, task assignment and leave; everything else stays in-app | Avoids notification fatigue |
| D29 | 2026-10-01 | Money is integer paise; all GST maths lives in `packages/core/src/finance.ts`, shared by the server (source of truth) and the editor preview | No float rounding errors; the preview always matches the saved invoice |
| D30 | 2026-10-01 | Quotes, invoices and credit notes share one table; numbers are assigned on issue, gap-free per kind and Indian financial year (INV/26-27/0001) | Meets GST serial-number rules; drafts don't burn numbers |
| D31 | 2026-10-01 | Issued documents are locked except due date and notes; corrections go through credit notes, which reduce the invoice balance | GST compliance and a clean audit trail |
| D32 | 2026-10-01 | Default GST slabs 0/5/18/40% (2025 rationalisation); orgs can add others | Current law, still flexible |
| D33 | 2026-10-01 | Invoice PDFs come from a print-styled HTML document (browser "Save as PDF") | Exact branding and ₹ glyphs, works offline, no PDF engine to ship |
| D34 | 2026-10-01 | Client links are HMAC-derived from the invoice id (stable across reminders); only the hash is stored | Every email carries the same working link; nothing reusable in the database |
| D35 | 2026-10-01 | Each org connects its own Razorpay; key and webhook secrets are AES-GCM encrypted (ENCRYPTION_KEY); webhooks are signature-checked and idempotent by payment id | Tenants collect into their own accounts; replays can't double-count |
| D36 | 2026-10-01 | Retainers and reminders run from a daily job (cloud cron) and lazily on the finance dashboard (offline) | No scheduler required in the offline edition |
| D37 | 2026-10-01 | Dashboard totals use the org currency only; foreign-currency balances are listed separately | Never add dollars to rupees |
