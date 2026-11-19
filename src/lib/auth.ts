import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import type { Tables } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

type CurrentProfile = Pick<
  Tables<"profiles">,
  | "id"
  | "role"
  | "access_status"
  | "legal_name"
  | "email"
  | "phone"
  | "date_of_birth"
  | "address"
  | "district"
  | "country"
  | "kyc_status"
  | "is_test"
  | "investment_limit_ugx"
  | "onboarding_completed_at"
>;

// Layouts and pages both check access, so dedupe the lookups within a render.
export const getCurrentProfile = cache(async (): Promise<CurrentProfile | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id,role,access_status,legal_name,email,phone,date_of_birth,address,district,country,kyc_status,is_test,investment_limit_ugx,onboarding_completed_at",
    )
    .eq("id", user.id)
    .maybeSingle();
  if (error || !data) return null;
  return data;
});

const getAssuranceLevel = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return data?.currentLevel;
});

export async function requireInvestor() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.access_status !== "active") redirect("/login?disabled=1");
  return profile;
}

export async function requireAdmin(
  options: { aal2?: boolean } = { aal2: true },
) {
  const profile = await requireInvestor();
  if (profile.role !== "admin") redirect("/dashboard");
  if (options.aal2 !== false && (await getAssuranceLevel()) !== "aal2") {
    redirect("/admin/mfa");
  }
  return profile;
}
