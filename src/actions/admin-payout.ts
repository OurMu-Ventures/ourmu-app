"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { publicError, requestId, toBytea } from "@/lib/db";
import { encryptPayoutReference } from "@/lib/security/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { payoutDestinationSchema, type ActionState } from "@/lib/validation";

const setupSchema = payoutDestinationSchema
  .omit({ accountReference: true })
  .extend({
    instructionId: z.uuid(),
    referenceSource: z.enum(["profile_phone", "manual"]),
    accountReference: z.string().trim().max(64),
    verificationMethod: z.enum(["phone", "email", "in_person"]),
    offlineVerified: z.literal("yes"),
  })
  .superRefine((input, ctx) => {
    if (
      input.referenceSource === "profile_phone" &&
      input.channel !== "mobile_money"
    )
      ctx.addIssue({
        code: "custom",
        path: ["referenceSource"],
        message: "Use an entered account reference for bank payouts.",
      });
    if (input.referenceSource === "manual" && input.accountReference.length < 3)
      ctx.addIssue({
        code: "custom",
        path: ["accountReference"],
        message: "Enter the payout account reference.",
      });
  });

export async function saveAdminPayoutDestination(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireAdmin();
  const supabase = await createClient();
  const { data: aal, error: aalError } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aalError || aal?.currentLevel !== "aal2")
    return {
      ok: false,
      message: "Complete administrator two-factor authentication first.",
    };
  const parsed = setupSchema.safeParse(
    Object.fromEntries(
      [
        "instructionId",
        "channel",
        "providerLabel",
        "accountName",
        "referenceSource",
        "accountReference",
        "verificationMethod",
        "offlineVerified",
      ].map((key) => [key, formData.get(key) ?? ""]),
    ),
  );
  if (!parsed.success)
    return {
      ok: false,
      message: "Enter the destination and confirm offline verification.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  const input = parsed.data;
  const admin = createAdminClient();
  const { data: instruction, error: instructionError } = await admin
    .from("maturity_instructions")
    .select("investor_id,status")
    .eq("id", input.instructionId)
    .maybeSingle();
  if (instructionError || !instruction || instruction.status !== "requested")
    return {
      ok: false,
      message:
        "Only a pending, unlocked maturity request can receive a payout destination.",
    };
  let accountReference = input.accountReference;
  let profileUpdatedAt: string | null = null;
  if (input.referenceSource === "profile_phone") {
    const { data: partner, error } = await admin
      .from("profiles")
      .select("phone,updated_at")
      .eq("id", instruction.investor_id)
      .maybeSingle();
    if (error || !partner?.phone)
      return {
        ok: false,
        message:
          "The partner has no phone number on file. Enter the verified account reference instead.",
      };
    accountReference = partner.phone;
    profileUpdatedAt = partner.updated_at;
  }
  let envelope: ReturnType<typeof encryptPayoutReference>;
  try {
    envelope = encryptPayoutReference(accountReference);
  } catch {
    return {
      ok: false,
      message:
        "The payout destination could not be secured. No changes were saved.",
    };
  }
  const { data, error } = await admin.rpc(
    "save_admin_maturity_payout_destination",
    {
      p_admin_id: profile.id,
      p_admin_aal2: true,
      p_instruction_id: input.instructionId,
      p_request_id: requestId(),
      p_verification_method: input.verificationMethod,
      p_reference_source: input.referenceSource,
      p_expected_profile_updated_at: profileUpdatedAt,
      p_destination: {
        channel: input.channel,
        provider_label: input.providerLabel,
        account_name: input.accountName,
        account_ref_ciphertext: toBytea(envelope.ciphertext),
        account_ref_iv: toBytea(envelope.iv),
        account_ref_auth_tag: toBytea(envelope.authTag),
        account_ref_fingerprint: toBytea(envelope.fingerprint),
        account_last_four: envelope.lastFour,
        key_version: envelope.keyVersion,
      },
    },
  );
  if (error)
    return {
      ok: false,
      message: publicError(
        error,
        "The verified destination could not be saved. No changes were made.",
      ),
    };
  revalidatePath("/admin/maturities");
  revalidatePath("/investments");
  const result = data as { needs_resolution?: boolean } | null;
  return {
    ok: true,
    message: result?.needs_resolution
      ? "Verified payout destination saved. Other resolution holds remain; review them before processing."
      : "Verified payout destination saved. The request is ready to begin processing. No payment or reinvestment has been executed.",
  };
}
