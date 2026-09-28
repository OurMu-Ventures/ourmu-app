"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireInvestor } from "@/lib/auth";
import { audit, requestId, toBytea } from "@/lib/db";
import { sendTransactionalEmail } from "@/lib/email/send";
import { getPublicEnv } from "@/lib/env";
import { fingerprintRequestValue, newAccountEmailToken } from "@/lib/security/crypto";
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

async function sendPrimaryEmailChangeVerification(email: string, token: string) {
  const url = new URL("/profile/emails/confirm", getPublicEnv().NEXT_PUBLIC_APP_URL);
  url.searchParams.set("token", token);
  await sendTransactionalEmail({
    to: email,
    template: "primary_email_change_verification",
    actionUrl: url.toString(),
    detail:
      "Opening this link alone changes nothing. Open it while signed in, review the change, and choose Confirm to make this address your primary email. The link expires in 24 hours and stops working once used.",
  });
}

const PRIMARY_EMAIL_CHANGE_REQUEST_TTL_MS = 24 * 60 * 60 * 1000;

type PrimaryChangeRequest = {
  id: string;
  user_id: string;
  new_email: string;
  mode: "new_address" | "promote_alias";
  account_email_id: string | null;
  expires_at: string | null;
  confirmed_at: string | null;
  finalized_at: string | null;
};

function primaryChangePendingMessage(email: string) {
  return `A change to ${email} is already pending. Use the link already sent to that address, or wait for it to expire before starting another.`;
}

function authEmailConflictMessage(message: string) {
  return /already|exist|taken|in use|duplicate/i.test(message);
}

export async function requestPrimaryEmailChange(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireInvestor();
  if (profile.role !== "investor")
    return { ok: false, message: "Primary email changes are available for partner accounts." };
  if (!(await hasFreshManagementSession("investor")))
    return { ok: false, message: "Use a fresh sign-in link, then try again within 10 minutes." };
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { ok: false, message: "Enter a valid email address." };

  const admin = createAdminClient();
  const { data: contacts } = await admin
    .from("account_emails")
    .select("id,email,is_primary")
    .eq("user_id", profile.id);
  if ((contacts ?? []).some((item) => item.is_primary && item.email === parsed.data))
    return { ok: false, message: "That address is already your primary email." };
  if ((contacts ?? []).some((item) => !item.is_primary && item.email === parsed.data))
    return { ok: false, message: "That address is already one of your contacts. Use “Make primary” to promote it." };
  const [{ data: taken }, { data: profileTaken }] = await Promise.all([
    admin.from("account_emails").select("id").eq("email", parsed.data).maybeSingle(),
    admin.from("profiles").select("id").eq("email", parsed.data).neq("id", profile.id).maybeSingle(),
  ]);
  if (taken || profileTaken)
    return { ok: false, message: "That email address is already linked to another account." };

  const { data: active } = await admin
    .from("primary_email_change_requests")
    .select("id,new_email,mode,confirmed_at,finalized_at,expires_at")
    .eq("user_id", profile.id)
    .is("finalized_at", null)
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle<PrimaryChangeRequest>();
  if (active && active.new_email === parsed.data && !active.confirmed_at) {
    // Same address, still unverified (possibly expired): rotate the token so
    // a lost mailbox message can be replaced without waiting out the old one.
    const { token, hash } = newAccountEmailToken();
    const { error } = await admin
      .from("primary_email_change_requests")
      .update({
        token_hash: toBytea(hash),
        expires_at: new Date(Date.now() + PRIMARY_EMAIL_CHANGE_REQUEST_TTL_MS).toISOString(),
      })
      .eq("id", active.id)
      .eq("user_id", profile.id)
      .is("finalized_at", null)
      .is("confirmed_at", null);
    if (error) return { ok: false, message: "The change request could not be prepared." };
    try {
      await sendPrimaryEmailChangeVerification(parsed.data, token);
    } catch {
      return { ok: false, message: "The verification email could not be sent. Please try again." };
    }
    await audit({ actorId: profile.id, action: "account_email.primary_change_resent", entityType: "primary_email_change_request", entityId: active.id, requestId: requestId() });
    revalidatePath("/profile");
    return { ok: true, message: "A new confirmation link was sent. Nothing changes until you open it and confirm." };
  }
  if (active) {
    return {
      ok: false,
      message: active.confirmed_at
        ? "That address is already verified. Open your confirmation link again to complete the change."
        : primaryChangePendingMessage(active.new_email),
    };
  }

  const { token, hash } = newAccountEmailToken();
  const { data, error } = await admin
    .from("primary_email_change_requests")
    .insert({
      user_id: profile.id,
      new_email: parsed.data,
      mode: "new_address",
      token_hash: toBytea(hash),
      expires_at: new Date(Date.now() + PRIMARY_EMAIL_CHANGE_REQUEST_TTL_MS).toISOString(),
    })
    .select("id")
    .single();
  if (error || !data)
    return {
      ok: false,
      message: error?.code === "23505"
        ? "A change is already pending. Use the link already sent before starting another."
        : "The change request could not be created.",
    };
  try {
    await sendPrimaryEmailChangeVerification(parsed.data, token);
  } catch {
    await admin.from("primary_email_change_requests").delete().eq("id", data.id).eq("user_id", profile.id);
    return { ok: false, message: "The verification email could not be sent. Please try again." };
  }
  await audit({ actorId: profile.id, action: "account_email.primary_change_requested", entityType: "primary_email_change_request", entityId: data.id, requestId: requestId(), metadata: { mode: "new_address" } });
  revalidatePath("/profile");
  return { ok: true, message: "Check the new mailbox for a confirmation link. Nothing changes until you open it and confirm." };
}

export async function promoteAdditionalEmail(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireInvestor();
  if (profile.role !== "investor")
    return { ok: false, message: "Primary email changes are available for partner accounts." };
  if (!(await hasFreshManagementSession("investor")))
    return { ok: false, message: "Use a fresh sign-in link, then try again within 10 minutes." };
  const id = z.uuid().safeParse(formData.get("emailId"));
  if (!id.success) return { ok: false, message: "The email address is unavailable." };
  const admin = createAdminClient();
  const { data: contact } = await admin
    .from("account_emails")
    .select("id,email,is_primary,verified_at")
    .eq("id", id.data)
    .eq("user_id", profile.id)
    .maybeSingle();
  if (!contact || contact.is_primary || !contact.verified_at)
    return { ok: false, message: "Only verified additional emails can be made primary." };
  const { data: active } = await admin
    .from("primary_email_change_requests")
    .select("id,new_email")
    .eq("user_id", profile.id)
    .is("finalized_at", null)
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle<PrimaryChangeRequest>();
  if (active) return { ok: false, message: primaryChangePendingMessage(active.new_email) };

  // Pre-confirmed: the deliberate button press plus the fresh session above
  // is the confirmation. The database trigger completes the swap atomically
  // with the Auth update below.
  const { data: request, error: requestError } = await admin
    .from("primary_email_change_requests")
    .insert({
      user_id: profile.id,
      new_email: contact.email,
      mode: "promote_alias",
      account_email_id: contact.id,
      confirmed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (requestError || !request)
    return {
      ok: false,
      message: requestError?.code === "23505"
        ? "A change is already pending. Use the link already sent before starting another."
        : "The primary email could not be changed.",
    };
  const { error: authError } = await admin.auth.admin.updateUserById(profile.id, {
    email: contact.email,
    email_confirm: true,
  });
  if (authError) {
    await admin
      .from("primary_email_change_requests")
      .delete()
      .eq("id", request.id)
      .eq("user_id", profile.id)
      .is("finalized_at", null);
    return {
      ok: false,
      message: authEmailConflictMessage(authError.message)
        ? "That email address is already linked to another account."
        : "The primary email could not be changed. Your existing primary still works.",
    };
  }
  const [{ data: finalized }, { data: current }] = await Promise.all([
    admin.from("primary_email_change_requests").select("finalized_at").eq("id", request.id).maybeSingle(),
    admin.from("profiles").select("email").eq("id", profile.id).maybeSingle(),
  ]);
  if (!finalized?.finalized_at || current?.email !== contact.email)
    return { ok: false, message: "The change could not be completed. If your sign-in still uses the old address, contact support." };
  await audit({ actorId: profile.id, action: "account_email.primary_change_confirmed", entityType: "primary_email_change_request", entityId: request.id, requestId: requestId(), metadata: { mode: "promote_alias" } });
  revalidatePath("/profile");
  return { ok: true, message: `Your primary email is now ${contact.email}. The previous address remains as a verified contact.` };
}

export async function confirmPrimaryEmailChange(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireInvestor();
  if (profile.role !== "investor")
    return { ok: false, message: "Primary email changes are available for partner accounts." };
  if (!(await hasFreshManagementSession("investor")))
    return { ok: false, message: "Use a fresh sign-in link, then open the confirmation link again within 10 minutes." };
  const rawToken = String(formData.get("token") ?? "");
  if (!rawToken || rawToken.length > 200)
    return { ok: false, message: "This confirmation link is invalid or has already been used." };
  const admin = createAdminClient();
  const hash = toBytea(fingerprintRequestValue("account-email", rawToken));
  const { data: request } = await admin
    .from("primary_email_change_requests")
    .select("id,user_id,new_email,mode,expires_at,confirmed_at,finalized_at")
    .eq("token_hash", hash)
    .maybeSingle<PrimaryChangeRequest>();
  if (!request || request.mode !== "new_address")
    return { ok: false, message: "This confirmation link is invalid or has already been used." };
  if (request.user_id !== profile.id)
    return { ok: false, message: "This confirmation link belongs to a different account. Sign in with the requesting account to continue." };
  if (request.finalized_at)
    return { ok: false, message: "This change is already complete. Sign in with your primary email." };
  if (request.expires_at && new Date(request.expires_at).getTime() <= Date.now())
    return { ok: false, message: "This confirmation link has expired. Request the change again for a new link." };
  if (!request.confirmed_at) {
    const { error } = await admin
      .from("primary_email_change_requests")
      .update({ confirmed_at: new Date().toISOString() })
      .eq("id", request.id)
      .eq("user_id", profile.id)
      .is("finalized_at", null)
      .is("confirmed_at", null);
    if (error) return { ok: false, message: "The change could not be confirmed. Please try again." };
    await audit({ actorId: profile.id, action: "account_email.primary_change_confirmed", entityType: "primary_email_change_request", entityId: request.id, requestId: requestId(), metadata: { mode: "new_address" } });
  }
  // Re-check conflicts at confirmation time: the address may have been
  // claimed or added since the request was created.
  const [{ data: contact }, { data: profileTaken }] = await Promise.all([
    admin.from("account_emails").select("id,user_id").eq("email", request.new_email).maybeSingle(),
    admin.from("profiles").select("id").eq("email", request.new_email).neq("id", profile.id).maybeSingle(),
  ]);
  if (profileTaken || (contact && contact.user_id !== profile.id))
    return { ok: false, message: "That email address is already linked to another account." };
  if (contact && contact.user_id === profile.id)
    return { ok: false, message: "That address is already one of your contacts. Remove it there before retrying, or use “Make primary”." };
  const { error: authError } = await admin.auth.admin.updateUserById(profile.id, {
    email: request.new_email,
    email_confirm: true,
  });
  if (authError)
    return {
      ok: false,
      message: authEmailConflictMessage(authError.message)
        ? "That email address is already linked to another account."
        : "The change could not be completed. Your existing primary email still works.",
    };
  const [{ data: finalized }, { data: current }] = await Promise.all([
    admin.from("primary_email_change_requests").select("finalized_at").eq("id", request.id).maybeSingle(),
    admin.from("profiles").select("email").eq("id", profile.id).maybeSingle(),
  ]);
  if (!finalized?.finalized_at || current?.email !== request.new_email)
    return { ok: false, message: "The change could not be completed. If your sign-in still uses the old address, contact support." };
  revalidatePath("/profile");
  return { ok: true, message: `Your primary email is now ${request.new_email}. Sign-in links and notifications will arrive there.` };
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
