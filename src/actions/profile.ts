"use server";

import { revalidatePath } from "next/cache";

import { requireInvestor } from "@/lib/auth";
import { audit, requestId } from "@/lib/db";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { nextOfKinSchema, type ActionState } from "@/lib/validation";

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
