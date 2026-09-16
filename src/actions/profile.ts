"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireInvestor } from "@/lib/auth";
import { audit, requestId, toBytea } from "@/lib/db";
import { sendTransactionalEmail } from "@/lib/email/send";
import { getPublicEnv } from "@/lib/env";
import { newAccountEmailToken } from "@/lib/security/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { emailSchema, nextOfKinSchema, type ActionState } from "@/lib/validation";

async function hasFreshManagementSession(role: "investor" | "admin") {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const issuedAt = Number(data?.claims?.iat ?? 0);
  if (!issuedAt || Date.now() / 1000 - issuedAt > 600) return false;
  if (role === "admin") {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    return aal?.currentLevel === "aal2";
  }
  return true;
}

async function sendAccountEmailVerification(email: string, token: string) {
  const url = new URL("/auth/email/verify", getPublicEnv().NEXT_PUBLIC_APP_URL);
  url.searchParams.set("token", token);
  await sendTransactionalEmail({
    to: email,
    template: "account_email_verification",
    actionUrl: url.toString(),
    detail: "Confirm this address before it can receive account messages or be used to sign in.",
  });
}

export async function addAccountEmail(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireInvestor();
  if (!(await hasFreshManagementSession(profile.role)))
    return { ok: false, message: "Use a fresh sign-in link, then try again within 10 minutes." };
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { ok: false, message: "Enter a valid email address." };

  const admin = createAdminClient();
  const { token, hash } = newAccountEmailToken();
  const { data, error } = await admin
    .from("account_emails")
    .insert({
      user_id: profile.id,
      email: parsed.data,
      is_primary: false,
      verification_token_hash: toBytea(hash),
      verification_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      verification_sent_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !data)
    return {
      ok: false,
      message: error?.code === "23514"
        ? "You can add at most two additional email addresses."
        : "That email address cannot be added.",
    };
  try {
    await sendAccountEmailVerification(parsed.data, token);
  } catch {
    await admin.from("account_emails").delete().eq("id", data.id).eq("user_id", profile.id);
    return { ok: false, message: "The verification email could not be sent. Please try again." };
  }
  await audit({ actorId: profile.id, action: "account_email.added", entityType: "account_email", entityId: data.id, requestId: requestId() });
  revalidatePath("/profile");
  return { ok: true, message: "Verification sent. The address remains inactive until confirmed." };
}

export async function resendAccountEmailVerification(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireInvestor();
  if (!(await hasFreshManagementSession(profile.role)))
    return { ok: false, message: "Use a fresh sign-in link, then try again within 10 minutes." };
  const id = z.uuid().safeParse(formData.get("emailId"));
  if (!id.success) return { ok: false, message: "The email address is unavailable." };
  const admin = createAdminClient();
  const { data: contact } = await admin.from("account_emails").select("email,verified_at,is_primary").eq("id", id.data).eq("user_id", profile.id).maybeSingle();
  if (!contact || contact.is_primary || contact.verified_at)
    return { ok: false, message: "Only pending additional emails can be resent." };
  const { token, hash } = newAccountEmailToken();
  const { error } = await admin.from("account_emails").update({
    verification_token_hash: toBytea(hash),
    verification_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    verification_sent_at: new Date().toISOString(),
  }).eq("id", id.data).eq("user_id", profile.id).is("verified_at", null);
  if (error) return { ok: false, message: "The verification email could not be prepared." };
  try {
    await sendAccountEmailVerification(contact.email, token);
  } catch {
    return { ok: false, message: "The verification email could not be sent. Please try again." };
  }
  await audit({ actorId: profile.id, action: "account_email.verification_resent", entityType: "account_email", entityId: id.data, requestId: requestId() });
  return { ok: true, message: "A new one-hour verification link was sent." };
}

export async function removeAccountEmail(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireInvestor();
  if (!(await hasFreshManagementSession(profile.role)))
    return { ok: false, message: "Use a fresh sign-in link, then try again within 10 minutes." };
  const id = z.uuid().safeParse(formData.get("emailId"));
  if (!id.success) return { ok: false, message: "The email address is unavailable." };
  const admin = createAdminClient();
  const { data, error } = await admin.from("account_emails").delete().eq("id", id.data).eq("user_id", profile.id).eq("is_primary", false).select("id").maybeSingle();
  if (error || !data) return { ok: false, message: "The primary email cannot be removed." };
  await audit({ actorId: profile.id, action: "account_email.removed", entityType: "account_email", entityId: id.data, requestId: requestId() });
  revalidatePath("/profile");
  return { ok: true, message: "The additional email was removed." };
}

export async function saveNextOfKin(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireInvestor();
  const parsed = nextOfKinSchema.safeParse({
    legalName: formData.get("legalName"),
    relationship: formData.get("relationship"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    address: formData.get("address"),
  });
  if (!parsed.success)
    return { ok: false, message: "Complete all required next-of-kin fields." };
  const admin = createAdminClient();
  const { error } = await admin
    .from("next_of_kin")
    .upsert(
      {
        user_id: profile.id,
        legal_name: parsed.data.legalName,
        relationship: parsed.data.relationship,
        phone: parsed.data.phone,
        email: parsed.data.email || null,
        address: parsed.data.address,
      },
      { onConflict: "user_id" },
    );
  if (error)
    return { ok: false, message: "Next-of-kin details could not be saved." };
  await admin
    .from("profiles")
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq("id", profile.id);
  revalidatePath("/profile");
  revalidatePath("/dashboard");
  return { ok: true, message: "Next-of-kin details saved." };
}

export async function requestAccountClosure(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireInvestor();
  const reason = String(formData.get("reason") ?? "")
    .trim()
    .slice(0, 1000);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("account_closure_requests")
    .insert({ user_id: profile.id, reason: reason || null })
    .select("id")
    .single();
  if (error || !data)
    return {
      ok: false,
      message:
        error?.code === "23505"
          ? "A closure request is already pending."
          : "The closure request could not be submitted.",
    };
  await admin
    .from("profiles")
    .update({ access_status: "disabled" })
    .eq("id", profile.id);
  await audit({
    actorId: profile.id,
    action: "account.closure_requested",
    entityType: "account_closure_request",
    entityId: data.id,
    requestId: requestId(),
  });
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "global" });
  return {
    ok: true,
    message:
      "Access has been disabled and your closure request is awaiting staff resolution.",
  };
}
