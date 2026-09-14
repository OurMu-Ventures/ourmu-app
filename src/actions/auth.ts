"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";

import { getPublicEnv } from "@/lib/env";
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
  await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${getPublicEnv().NEXT_PUBLIC_APP_URL}/auth/confirm${
        safeNext ? `?next=${encodeURIComponent(safeNext)}` : ""
      }`,
    },
  });
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
