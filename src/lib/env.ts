import "server-only";

import { z } from "zod";

const publicSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
});

const serverSchema = publicSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  IDENTITY_MASTER_KEY_BASE64: z.string().min(40),
  CRON_SECRET: z.string().min(32),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().min(3),
  LEGAL_PRIVACY_VERSION: z.string().min(1),
  AGREEMENT_PLACEHOLDER_BLOCK: z.enum(["true", "false"]).default("true"),
});

export type PublicEnv = z.infer<typeof publicSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

export function getPublicEnv(): PublicEnv {
  return publicSchema.parse(process.env);
}

export function getServerEnv(): ServerEnv {
  return serverSchema.parse(process.env);
}

export function isEnvironmentConfigured() {
  return publicSchema.safeParse(process.env).success;
}
