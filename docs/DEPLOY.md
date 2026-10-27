# Deploying the cloud edition

One Vercel project serves both the SPA and the API from the same domain (currently `siemmi.com`).

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
In **Admin → Products → Operant → Sign-in** (accounts.webrizen.com):

| Field | Value |
|---|---|
| Redirect URLs | `https://app.<domain>/auth/callback` (add `http://localhost:5173/auth/callback` for development) |
| After sign-out URLs | `https://app.<domain>/signed-out` |

Copy the client ID and client secret (the secret is shown once). Operant's roles (partner, manager,
staff, accounts, hr) live under **Roles**; what each role can do is mapped in
`packages/core/src/permissions.ts` (`WEBRIZEN_ROLE_PERMISSIONS`). Organization owners and admins can
do everything. The people directory syncs from Webrizen when people sign in and as their sessions
refresh (every 10 minutes).

## 3. Vercel
One Vercel project serves everything. `vercel.json` at the repo root defines four services and routes by hostname:

| Address | Goes to |
|---|---|
| `app.<domain>` | `web` (staff app); `/api`, `/auth` and `/webhooks` go to `cloud` (the API) |
| `portal.<domain>` | `portal` (client portal); `/api` goes to `cloud` |
| anything else (`<domain>`, `www.<domain>`, `*.vercel.app`) | `marketing` |

1. Import the GitHub repo. Leave **Root Directory** as the repo root and the preset as **Services**.
2. Environment variables (Production). See `apps/cloud/.env.example` for descriptions.

   | Variable | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `APP_URL` | `https://app.<domain>` |
   | `PORTAL_URL` | `https://portal.<domain>` |
   | `SESSION_SECRET` | 32+ random characters (`openssl rand -base64 32`) |
   | `WEBRIZEN_SSO_CLIENT_ID` / `WEBRIZEN_SSO_CLIENT_SECRET` | from SSO |
   | `DATABASE_URL` | Supabase **transaction pooler** URL |
   | `SUPABASE_URL` / `SUPABASE_SECRET_KEY` / `SUPABASE_JWT_SECRET` / `SUPABASE_PUBLISHABLE_KEY` | from Supabase (the publishable key lets browsers connect to Realtime) |
   | `RESEND_API_KEY` / `EMAIL_FROM` | from Resend, for emails and for organizations' own sending domains (optional) |
   | `CRON_SECRET` | random string (also used in the pg_cron jobs) |
   | `ENCRYPTION_KEY` | 32+ random characters; encrypts tenants' Razorpay secrets. Set it once and keep it (defaults to SESSION_SECRET) |
   | `PUBLIC_SITE_URL` | `https://<domain>` (marketing: canonical links, sitemap, share images) |
   | `PUBLIC_APP_URL` / `PUBLIC_PORTAL_URL` | same as `APP_URL` / `PORTAL_URL` (marketing links) |
   | `PUBLIC_CONTACT_EMAIL` | shown in the marketing footer (optional) |

3. Deploy, then add three domains to the project: `<domain>`, `app.<domain>` and `portal.<domain>`.
4. In the SSO, the redirect is `https://app.<domain>/auth/callback` and the webhook is `https://app.<domain>/webhooks/webrizen`.
5. Enable the scheduled jobs at the bottom of `supabase-setup.sql` (they call `https://app.<domain>/api/cron/...`): nightly member sync, and the daily finance job.

No service calls another one server to server, so there are no service bindings.

Fallback without services: delete `vercel.json`, set the preset to **Other** and the build command to `pnpm build:vercel`. That deploys the staff app and API only, as one function.

## Every release
- If the schema changed, run `pnpm db:migrate` against the direct URL **before** deploying.
- CI runs typecheck, tests, a migration drift check, and the production build on every push.

## Marketing site (`apps/marketing`)

A static Astro site, deployed as the `marketing` service above. Its `PUBLIC_*` variables are read at build time. Update `public/robots.txt` if the site's address changes.
