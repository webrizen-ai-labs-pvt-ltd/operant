# Operant

Webrizen's operations platform: **People**, **Work**, **Collaboration** and **Finance** in one place.
One codebase ships two editions: a multi-tenant **cloud SaaS** and a standalone **offline edition** for office networks.

See [PLAN.md](PLAN.md) for the full plan and [docs/](docs) for architecture, decisions and deployment.

## Run it locally

Requirements: Node 22+ and pnpm.

```bash
pnpm install
pnpm dev
```

Open http://localhost:5173.

- With no configuration, the API uses an **embedded Postgres** (stored in `apps/cloud/.data/`).
- You sign in with a **local demo account**.
- To sign in with Webrizen SSO, copy `apps/cloud/.env.example` to `apps/cloud/.env.local` and fill in the SSO values.

## Repository layout

| Path | What it is |
|---|---|
| `apps/web` | React SPA: the whole product UI, used by both editions |
| `apps/cloud` | Cloud edition server: Webrizen SSO login, sessions, Supabase adapters |
| `apps/desktop` | Offline edition (Electron), coming in Phase 5 |
| `packages/api` | Edition-agnostic API (Hono) |
| `packages/db` | Drizzle schema and SQL migrations (Supabase Postgres and PGlite) |
| `packages/core` | Permissions, adapter interfaces, shared types |
| `packages/ui` | Forge design system |

## Common commands

| Command | Does |
|---|---|
| `pnpm dev` | API on :8787 and web on :5173 |
| `pnpm test` | All tests (the API tests run against an in-memory Postgres) |
| `pnpm typecheck` | Type-check every package |
| `pnpm db:generate` | Create a migration after changing `packages/db/src/schema` |
| `pnpm db:migrate` | Apply migrations to the cloud database (`DATABASE_URL`) |
| `pnpm build:vercel` | Production build in Vercel's output format |

© Webrizen AI Labs Pvt Ltd. Proprietary.
