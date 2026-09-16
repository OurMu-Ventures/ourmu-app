"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { headers } from "next/headers";

import { getPublicEnv } from "@/lib/env";
import { sendTransactionalEmail } from "@/lib/email/send";
import { fingerprintRequestValue } from "@/lib/security/crypto";
import { toBytea } from "@/lib/db";
import { resolveNextPath, sanitizeNextPath } from "@/lib/redirect";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { emailSchema, type ActionState } from "@/lib/validation";

export async function requestMagicLink(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success)
    return { ok: false, message: "Enter a valid email address." };
  // Syntactic check only: the caller's role is unknown pre-authentication
  // (the response must stay identical either way), so role gating happens
  // at the callback. Carried in the callback URL with a short-lived cookie
  // fallback in case the email provider strips query parameters.
  const rawNext = formData.get("next");
  const safeNext = sanitizeNextPath(
    typeof rawNext === "string" ? rawNext : null,
  );
  const supabase = await createClient();
  const redirectTo = `${getPublicEnv().NEXT_PUBLIC_APP_URL}/auth/confirm${safeNext ? `?next=${encodeURIComponent(safeNext)}` : ""}`;
  const admin = createAdminClient();
  // Primary addresses remain native Supabase identities and use signInWithOtp
  // below. Only verified, non-primary contacts need the alias bridge.
  const { data: alias } = await admin.from("account_emails").select("user_id").eq("email", parsed.data).eq("is_primary", false).not("verified_at", "is", null).maybeSingle();
  let error: { code?: string } | null = null;
  if (alias) {
    const { data: profile } = await admin.from("profiles").select("email,access_status,is_test").eq("id", alias.user_id).maybeSingle();
    if (profile?.access_status === "active" && !profile.is_test) {
      const headerStore = await headers();
      const forwarded = headerStore.get("x-forwarded-for")?.split(",")[0]?.trim();
      const ip = forwarded || headerStore.get("x-real-ip") || "unknown";
      const ipHash = toBytea(fingerprintRequestValue("alias-login-ip", ip));
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const [{ count: accountCount }, { count: ipCount }] = await Promise.all([
        admin.schema("private").from("alias_login_attempts").select("id", { count: "exact", head: true }).eq("user_id", alias.user_id).gte("requested_at", since),
        admin.schema("private").from("alias_login_attempts").select("id", { count: "exact", head: true }).eq("ip_fingerprint", ipHash).gte("requested_at", since),
      ]);
      // Match the configured Supabase email allowance (2/hour per account)
      // while also bounding distributed requests from one source IP.
      if ((accountCount ?? 0) < 2 && (ipCount ?? 0) < 10) {
        await admin.schema("private").from("alias_login_attempts").insert({ user_id: alias.user_id, ip_fingerprint: ipHash });
        const generated = await admin.auth.admin.generateLink({ type: "magiclink", email: profile.email, options: { redirectTo } });
        if (generated.error || !generated.data.properties?.action_link) error = generated.error ?? { code: "link_generation_failed" };
        else {
          try {
            await sendTransactionalEmail({ to: parsed.data, template: "alias_magic_link", actionUrl: generated.data.properties.action_link });
          } catch {
            error = { code: "delivery_failed" };
          }
        }
      }
    }
  } else {
    const result = await supabase.auth.signInWithOtp({
      email: parsed.data,
      options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
    });
    error = result.error;
  }
  if (error) {
    // Keep the public response non-enumerating. Provider messages can include
    // account data, so production logs receive only a stable operation code.
    console.error("auth.magic_link.request_failed", {
      code: error.code ?? "unknown",
    });
  }
  const cookieStore = await cookies();
  if (safeNext) {
    cookieStore.set("pending_next", safeNext, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/auth/confirm",
      maxAge: 600,
    });
  } else {
    cookieStore.delete("pending_next");
  }
  // Deliberately identical whether or not an account exists.
  return {
    ok: true,
    message:
      "If your approved account exists, a secure sign-in link is on its way.",
  };
}

export async function signInTestAccount(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = emailSchema.safeParse(formData.get("email"));
  const password = String(formData.get("password") ?? "");
  if (!email.success || password.length < 12 || password.length > 128)
    return { ok: false, message: "Email or password is incorrect." };

  // Password login is deliberately restricted to explicitly marked test
  // profiles. Real partners continue to use email magic links.
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("id,access_status,is_test")
    .eq("email", email.data)
    .eq("role", "investor")
    .maybeSingle();
  if (!profile?.is_test || profile.access_status !== "active")
    return { ok: false, message: "Email or password is incorrect." };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.data,
    password,
  });
  if (error || data.user?.id !== profile.id) {
    if (data.session) await supabase.auth.signOut({ scope: "local" });
    return { ok: false, message: "Email or password is incorrect." };
  }

  const rawNext = formData.get("next");
  redirect(resolveNextPath(rawNext, "investor"));
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "global" });
  redirect("/login");
}
