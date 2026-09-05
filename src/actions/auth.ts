"use server";

import { redirect } from "next/navigation";

import { getPublicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { emailSchema, type ActionState } from "@/lib/validation";

export async function requestMagicLink(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success)
    return { ok: false, message: "Enter a valid email address." };
  const supabase = await createClient();
  await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${getPublicEnv().NEXT_PUBLIC_APP_URL}/auth/confirm`,
    },
  });
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
