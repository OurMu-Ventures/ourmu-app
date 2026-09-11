"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";

import { getPublicEnv } from "@/lib/env";
import { sanitizeNextPath } from "@/lib/redirect";
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

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "global" });
  redirect("/login");
}
