# Deploying the cloud edition

One Vercel project serves both the SPA and the API from the same domain (for example `operant.webrizen.com`).

## 1. Supabase
1. Create a project, region **Mumbai (ap-south-1)**.
2. **Settings → Database:** copy two connection strings:
   - the **direct** connection (port 5432), for migrations
   - the **transaction pooler** (port 6543), for the app
3. Apply the tables from your machine:
   ```bash
   DATABASE_URL="<direct connection string>" pnpm db:migrate
   ```
4. **SQL editor:** run [`supabase-setup.sql`](supabase-setup.sql). It creates the files bucket and the Realtime rules.
5. **Settings → API:**
   - copy the project URL and the **secret** key
   - under JWT settings, copy the **JWT secret**

## 2. Webrizen SSO
In **Platform → Applications → Register application**:

| Field | Value |
|---|---|
| Redirect URI | `https://<domain>/auth/callback` (add `http://localhost:5173/auth/callback` for development) |
| Sign-out redirect URI | `https://<domain>/signed-out` |
| Directory API | **On** (needed for the people directory) |
| Webhook endpoint | `https://<domain>/webhooks/webrizen`, events: `member.*`, `role.*`, `organization.deleted` |
| Permission resources | the catalogue in `packages/core/src/permissions.ts` (also in PLAN.md §5.4) |

Copy the client ID, client secret and webhook signing secret.

## 3. Vercel
1. Import the GitHub repo and leave **Root Directory** as the repo root.
2. **Build command:** `pnpm build:vercel`. **Framework preset:** Other.
3. Environment variables (Production). See `apps/cloud/.env.example` for descriptions.

   | Variable | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `APP_URL` | `https://<domain>` |
   | `SESSION_SECRET` | 32+ random characters (`openssl rand -base64 32`) |
   | `WEBRIZEN_SSO_CLIENT_ID` / `WEBRIZEN_SSO_CLIENT_SECRET` | from SSO |
   | `WEBRIZEN_WEBHOOK_SECRET` | from SSO (`whsec_…`) |
   | `DATABASE_URL` | Supabase **transaction pooler** URL |
   | `SUPABASE_URL` / `SUPABASE_SECRET_KEY` / `SUPABASE_JWT_SECRET` / `SUPABASE_PUBLISHABLE_KEY` | from Supabase (the publishable key lets browsers connect to Realtime) |
   | `RESEND_API_KEY` / `EMAIL_FROM` | from Resend, for mention, message, assignment and leave emails (optional) |
   | `CRON_SECRET` | random string (also used in the pg_cron jobs) |
   | `ENCRYPTION_KEY` | 32+ random characters; encrypts tenants' Razorpay secrets. Set it once and keep it (defaults to SESSION_SECRET) |

4. Add the custom domain.
5. Enable the scheduled jobs at the bottom of `supabase-setup.sql`: nightly member sync, and the daily finance job (`/api/cron/finance`: retainers and overdue reminders).

## Every release
- If the schema changed, run `pnpm db:migrate` against the direct URL **before** deploying.
- CI runs typecheck, tests, a migration drift check, and the production build on every push.

## Marketing site (`apps/marketing`)

A static Astro site: every page is plain HTML, so any static host works (a separate Vercel project is simplest).

- Root directory: `apps/marketing`, build command `pnpm build`, output directory `dist`.
- Environment variables (all optional, read at build time):
  - `PUBLIC_SITE_URL`: the site's own address, for canonical links, the sitemap and share images (default `https://operant.webrizen.com`).
  - `PUBLIC_APP_URL`: where "Get started" and "Sign in" go (the web app).
  - `PUBLIC_PORTAL_URL`: the client portal.
  - `PUBLIC_CONTACT_EMAIL`: shown in the footer and used for "Book a demo".
- Update `public/robots.txt` if the site's address changes.
