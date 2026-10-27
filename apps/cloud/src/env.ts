import { z } from "zod";

const optional = z.string().trim().optional().transform((v) => (v ? v : undefined));

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  APP_URL: z.url().default("http://localhost:5173"),
  /** The client portal app (its own site). */
  PORTAL_URL: z.url().default("http://localhost:5175"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  /** Encrypts stored gateway secrets. Defaults to SESSION_SECRET; set separately so sessions can rotate. */
  ENCRYPTION_KEY: optional.pipe(z.string().min(32, "ENCRYPTION_KEY must be at least 32 characters").optional()),

  WEBRIZEN_SSO_ISSUER: z.url().default("https://accounts.webrizen.com/api/auth"),
  WEBRIZEN_SSO_CLIENT_ID: optional,
  WEBRIZEN_SSO_CLIENT_SECRET: optional,

  DATABASE_URL: optional,
  PGLITE_DIR: z.string().default(".data/pglite"),
  LOCAL_FILES_DIR: z.string().default(".data/files"),

  SUPABASE_URL: optional,
  SUPABASE_SECRET_KEY: optional,
  SUPABASE_STORAGE_BUCKET: z.string().default("operant"),
  SUPABASE_JWT_SECRET: optional,
  SUPABASE_PUBLISHABLE_KEY: optional,

  RESEND_API_KEY: optional,
  EMAIL_FROM: z.string().default("Operant <no-reply@webrizen.com>"),

  CRON_SECRET: optional,
  DEV_AUTH: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
});

export type Env = z.infer<typeof schema> & {
  isProd: boolean;
  ssoConfigured: boolean;
  devAuth: boolean;
};

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}`);
  }
  const env = parsed.data;
  const isProd = env.NODE_ENV === "production";
  const ssoConfigured = Boolean(env.WEBRIZEN_SSO_CLIENT_ID && env.WEBRIZEN_SSO_CLIENT_SECRET);
  if (isProd && !ssoConfigured) throw new Error("Webrizen SSO client credentials are required in production");
  if (isProd && !env.DATABASE_URL) throw new Error("DATABASE_URL is required in production");
  return { ...env, isProd, ssoConfigured, devAuth: env.DEV_AUTH && !isProd };
}
