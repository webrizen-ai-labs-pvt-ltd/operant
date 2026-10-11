// Builds the cloud edition in Vercel's Build Output API format:
//   .vercel/output/static            the SPA (apps/web/dist)
//   .vercel/output/functions/api.func one bundled Node.js function (Hono API)
//   .vercel/output/config.json        routing: API/auth/webhooks → function, everything else → SPA
// Kept as the fallback to the services setup in vercel.json, and as the CI bundle check.
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { build } from "esbuild";

const out = ".vercel/output";
rmSync(out, { recursive: true, force: true });

execSync("pnpm --filter @operant/web build", { stdio: "inherit" });
cpSync("apps/web/dist", `${out}/static`, { recursive: true });

const fn = `${out}/functions/api.func`;
mkdirSync(fn, { recursive: true });
await build({
  entryPoints: ["apps/cloud/src/node.ts"],
  outfile: `${fn}/index.mjs`,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // PGlite is only used offline / in local dev and is loaded lazily.
  external: ["@electric-sql/pglite", "drizzle-orm/pglite", "drizzle-orm/pglite/migrator"],
  // Some bundled CommonJS dependencies call require().
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: "info",
});
writeFileSync(
  `${fn}/.vc-config.json`,
  JSON.stringify({ runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs", shouldAddHelpers: false }, null, 2),
);

writeFileSync(
  `${out}/config.json`,
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: "^/assets/(.*)$", headers: { "cache-control": "public, max-age=31536000, immutable" }, continue: true },
        { src: "^/(api|auth|webhooks)(/.*)?$", dest: "/api" },
        { handle: "filesystem" },
        {
          src: "^/(.*)$",
          dest: "/index.html",
          headers: {
            "content-security-policy":
              "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self'; connect-src 'self' https://*.supabase.co wss://*.supabase.co; frame-ancestors 'none'; base-uri 'self'",
            "x-frame-options": "DENY",
            "x-content-type-options": "nosniff",
            "referrer-policy": "strict-origin-when-cross-origin",
          },
        },
      ],
    },
    null,
    2,
  ),
);
console.log(`Vercel output ready in ${out}`);
