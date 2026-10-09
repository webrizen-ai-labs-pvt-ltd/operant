/**
 * Everything on the site that depends on where Operant is deployed. Set these with
 * PUBLIC_* environment variables at build time; the defaults are for local development.
 */
export const SITE = {
  name: "Operant",
  maker: "Webrizen AI Labs",
  tagline: "People, work, clients and money, in one place.",
  description:
    "Operant runs your business in one place: your team and leave, projects and tasks, team chat, GST invoices and payments, and a portal for your clients. Built in India for growing firms.",
  appUrl: import.meta.env.PUBLIC_APP_URL ?? "http://localhost:5173",
  portalUrl: import.meta.env.PUBLIC_PORTAL_URL ?? "http://localhost:5175",
  contactEmail: import.meta.env.PUBLIC_CONTACT_EMAIL ?? "hello@webrizen.com",
};

export const signUpUrl = `${SITE.appUrl}/`;
export const demoUrl = `mailto:${SITE.contactEmail}?subject=${encodeURIComponent("Operant demo")}`;
