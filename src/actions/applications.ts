"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth";
import { audit, requestId, toBytea } from "@/lib/db";
import { sendTransactionalEmail } from "@/lib/email/send";
import { getServerEnv } from "@/lib/env";
import {
  encryptNin,
  fingerprintRequestValue,
  newInviteToken,
} from "@/lib/security/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  applicationSchema,
  invitationSchema,
  type ActionState,
} from "@/lib/validation";

export async function createInvitation(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const adminProfile = await requireAdmin();
  const parsed = invitationSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success)
    return { ok: false, message: "Enter a valid email address." };
  const token = newInviteToken();
  const admin = createAdminClient();
  const id = requestId();
  const { data, error } = await admin
    .from("application_invitations")
    .insert({
      invited_email: parsed.data.email,
      token_hash: toBytea(token.hash),
      expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      issued_by: adminProfile.id,
    })
    .select("id")
    .single();
  if (error || !data)
    return { ok: false, message: "The invitation could not be issued." };
  const env = getServerEnv();
  const url = `${env.NEXT_PUBLIC_APP_URL}/apply/${token.token}`;
  const manualDelivery =
    env.ALLOW_MANUAL_TEST_LINKS === "true" && !env.RESEND_API_KEY;
  try {
    if (!manualDelivery)
      await sendTransactionalEmail({
        to: parsed.data.email,
        template: "application_invitation",
        actionUrl: url,
      });
    await audit({
      actorId: adminProfile.id,
      action: "invitation.issued",
      entityType: "application_invitation",
      entityId: data.id,
      requestId: id,
      metadata: { delivery: manualDelivery ? "manual_test" : "email" },
    });
  } catch {
    await admin
      .from("application_invitations")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.id);
    return {
      ok: false,
      message:
        "Email delivery failed. The unused link was revoked; reissue when email is configured.",
    };
  }
  revalidatePath("/admin/invitations");
  return {
    ok: true,
    message: manualDelivery
      ? "Invitation created for controlled testing. The raw token was not stored."
      : "Invitation sent. The raw token was not stored.",
    sensitiveAction: manualDelivery
      ? { url, label: "Open or copy the one-time application link" }
      : undefined,
  };
}

export async function revokeInvitation(formData: FormData) {
  const adminProfile = await requireAdmin();
  const invitationId = String(formData.get("invitationId") ?? "");
  const admin = createAdminClient();
  const { error } = await admin
    .from("application_invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", invitationId)
    .is("used_at", null);
  if (error) throw new Error("Invitation revocation failed");
  await audit({
    actorId: adminProfile.id,
    action: "invitation.revoked",
    entityType: "application_invitation",
    entityId: invitationId,
    requestId: requestId(),
  });
  revalidatePath("/admin/invitations");
}

export async function reissueInvitation(formData: FormData) {
  const adminProfile = await requireAdmin();
  const invitationId = String(formData.get("invitationId") ?? "");
  const admin = createAdminClient();
  const { data: prior } = await admin
    .from("application_invitations")
    .select("id,invited_email,used_at")
    .eq("id", invitationId)
    .single();
  if (!prior || prior.used_at)
    throw new Error("Only unused invitations can be reissued");

  const token = newInviteToken();
  const now = new Date().toISOString();
  await admin
    .from("application_invitations")
    .update({ revoked_at: now })
    .eq("id", prior.id)
    .is("used_at", null);
  const { data: replacement, error } = await admin
    .from("application_invitations")
    .insert({
      invited_email: prior.invited_email,
      token_hash: toBytea(token.hash),
      expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      issued_by: adminProfile.id,
      supersedes_id: prior.id,
    })
    .select("id")
    .single();
  if (error || !replacement) throw new Error("Invitation reissue failed");

  try {
    await sendTransactionalEmail({
      to: prior.invited_email,
      template: "application_invitation",
      actionUrl: `${getServerEnv().NEXT_PUBLIC_APP_URL}/apply/${token.token}`,
    });
  } catch {
    await admin
      .from("application_invitations")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", replacement.id);
    throw new Error(
      "The replacement was revoked because email delivery failed",
    );
  }
  await audit({
    actorId: adminProfile.id,
    action: "invitation.reissued",
    entityType: "application_invitation",
    entityId: replacement.id,
    requestId: requestId(),
    metadata: { supersedes_id: prior.id },
  });
  revalidatePath("/admin/invitations");
}

export async function submitApplication(
  token: string,
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = applicationSchema.safeParse({
    legalName: formData.get("legalName"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    dateOfBirth: formData.get("dateOfBirth"),
    nin: formData.get("nin"),
    address: formData.get("address"),
    district: formData.get("district"),
    country: formData.get("country"),
    consent: formData.get("consent"),
  });
  if (!parsed.success)
    return {
      ok: false,
      message: "Review the highlighted information and try again.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  const admin = createAdminClient();
  const tokenHash = toBytea(fingerprintRequestValue("invite", token));
  const { data: invitation } = await admin
    .from("application_invitations")
    .select("id,invited_email,expires_at,used_at,revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (
    !invitation ||
    invitation.used_at ||
    invitation.revoked_at ||
    new Date(invitation.expires_at) <= new Date() ||
    invitation.invited_email !== parsed.data.email
  ) {
    return {
      ok: false,
      message: "This application link is invalid or no longer available.",
    };
  }
  const envelope = encryptNin(parsed.data.nin);
  const applicationId = requestId();
  const now = new Date().toISOString();
  const { error: appError } = await admin.from("investor_applications").insert({
    id: applicationId,
    invitation_id: invitation.id,
    legal_name: parsed.data.legalName,
    email: parsed.data.email,
    phone: parsed.data.phone,
    date_of_birth: parsed.data.dateOfBirth,
    address: parsed.data.address,
    district: parsed.data.district,
    country: parsed.data.country,
    privacy_policy_version: getServerEnv().LEGAL_PRIVACY_VERSION,
    privacy_consented_at: now,
  });
  if (appError)
    return {
      ok: false,
      message:
        appError.code === "23505"
          ? "An application is already in progress for these details."
          : "The application could not be submitted.",
    };
  const { error: identityError } = await admin
    .schema("private")
    .from("investor_identities")
    .insert({
      application_id: applicationId,
      nin_ciphertext: toBytea(envelope.ciphertext),
      nin_iv: toBytea(envelope.iv),
      nin_auth_tag: toBytea(envelope.authTag),
      nin_fingerprint: toBytea(envelope.fingerprint),
      nin_last_four: envelope.lastFour,
      key_version: envelope.keyVersion,
    });
  if (identityError) {
    await admin.from("investor_applications").delete().eq("id", applicationId);
    return {
      ok: false,
      message:
        identityError.code === "23505"
          ? "An application is already associated with this identity."
          : "The application could not be secured.",
    };
  }
  const { error: inviteError } = await admin
    .from("application_invitations")
    .update({ used_at: now })
    .eq("id", invitation.id)
    .is("used_at", null)
    .is("revoked_at", null);
  if (inviteError) throw new Error("Invitation finalization failed");
  await audit({
    action: "application.submitted",
    entityType: "investor_application",
    entityId: applicationId,
    requestId: requestId(),
  });
  return {
    ok: true,
    message:
      "Application received. OURMU staff will contact you after offline verification.",
  };
}

export async function approveApplication(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const reviewer = await requireAdmin();
  const applicationId = String(formData.get("applicationId") ?? "");
  const verificationReference = String(
    formData.get("verificationReference") ?? "",
  ).trim();
  const notes = String(formData.get("notes") ?? "").trim();
  if (!verificationReference)
    return {
      ok: false,
      message: "A non-sensitive KYC verification reference is required.",
    };
  const admin = createAdminClient();
  const { data: application } = await admin
    .from("investor_applications")
    .select("*")
    .eq("id", applicationId)
    .single();
  if (!application) return { ok: false, message: "Application not found." };
  if (application.status === "approved")
    return { ok: true, message: "This application is already approved." };
  if (application.status !== "submitted")
    return {
      ok: false,
      message: "Only submitted applications may be approved.",
    };
  let userId = application.auth_user_id as string | null;
  if (!userId) {
    const { data, error } = await admin.auth.admin.createUser({
      email: application.email,
      email_confirm: true,
    });
    if (error || !data.user)
      return { ok: false, message: "The Supabase user could not be created." };
    userId = data.user.id;
  }
  const now = new Date().toISOString();
  const { error: profileError } = await admin.from("profiles").upsert({
    id: userId,
    role: "investor",
    access_status: "active",
    legal_name: application.legal_name,
    email: application.email,
    phone: application.phone,
    date_of_birth: application.date_of_birth,
    address: application.address,
    district: application.district,
    country: application.country,
    kyc_status: "verified",
    kyc_verified_at: now,
  });
  if (profileError)
    return { ok: false, message: "The investor profile could not be created." };
  await admin
    .schema("private")
    .from("investor_identities")
    .update({ user_id: userId })
    .eq("application_id", applicationId);
  const { error } = await admin
    .from("investor_applications")
    .update({
      status: "approved",
      auth_user_id: userId,
      kyc_verification_reference: verificationReference,
      kyc_notes: notes || null,
      reviewed_by: reviewer.id,
      reviewed_at: now,
    })
    .eq("id", applicationId)
    .eq("status", "submitted");
  if (error) return { ok: false, message: "Approval could not be finalized." };
  const env = getServerEnv();
  const redirectTo = `${env.NEXT_PUBLIC_APP_URL}/auth/confirm`;
  const manualLinkMode =
    env.ALLOW_MANUAL_TEST_LINKS === "true" && !env.RESEND_API_KEY;
  let manualMagicLink: string | undefined;
  if (manualLinkMode) {
    const { data: linkData, error: linkError } =
      await admin.auth.admin.generateLink({
        type: "magiclink",
        email: application.email,
        options: { redirectTo },
      });
    if (!linkError) manualMagicLink = linkData.properties.action_link;
  } else {
    const supabase = await createClient();
    await supabase.auth.signInWithOtp({
      email: application.email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: redirectTo,
      },
    });
  }
  await audit({
    actorId: reviewer.id,
    action: "application.approved",
    entityType: "investor_application",
    entityId: applicationId,
    requestId: requestId(),
    metadata: { user_id: userId },
  });
  revalidatePath("/admin/applications");
  return {
    ok: true,
    message: manualMagicLink
      ? "Application approved. Use the one-time test sign-in link below."
      : manualLinkMode
        ? "Application approved, but a test sign-in link could not be generated."
        : "Application approved and the first magic link requested.",
    sensitiveAction: manualMagicLink
      ? { url: manualMagicLink, label: "Open or copy the test sign-in link" }
      : undefined,
  };
}

export async function rejectApplication(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const reviewer = await requireAdmin();
  const applicationId = String(formData.get("applicationId") ?? "");
  const reference = String(formData.get("verificationReference") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  if (!reference)
    return { ok: false, message: "A verification reference is required." };
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { error } = await admin
    .from("investor_applications")
    .update({
      status: "rejected",
      kyc_verification_reference: reference,
      kyc_notes: notes || null,
      reviewed_by: reviewer.id,
      reviewed_at: now,
    })
    .eq("id", applicationId)
    .eq("status", "submitted");
  if (error) return { ok: false, message: "Rejection could not be recorded." };
  await admin
    .schema("private")
    .from("investor_identities")
    .update({
      nin_ciphertext: null,
      nin_iv: null,
      nin_auth_tag: null,
      nin_fingerprint: null,
      erased_at: now,
    })
    .eq("application_id", applicationId)
    .is("erased_at", null);
  await audit({
    actorId: reviewer.id,
    action: "application.rejected",
    entityType: "investor_application",
    entityId: applicationId,
    requestId: requestId(),
  });
  revalidatePath("/admin/applications");
  return {
    ok: true,
    message:
      "Application rejected; encrypted NIN material was erased immediately.",
  };
}
