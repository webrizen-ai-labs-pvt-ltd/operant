import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// The public site: every page is plain HTML at build time; only the interactive
// parts (product tour, calculators) ship JavaScript, and only when they're on screen.
export default defineConfig({
  site: process.env.PUBLIC_SITE_URL ?? "https://operant.webrizen.com",
  integrations: [react(), sitemap()],
  vite: { plugins: [tailwindcss()] },
  server: { port: 4321 },
  devToolbar: { enabled: false },
  prefetch: { prefetchAll: true, defaultStrategy: "viewport" },
});
