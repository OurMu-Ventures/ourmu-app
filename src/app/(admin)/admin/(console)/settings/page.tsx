import { BankInstructionsForm } from "@/components/forms";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
export default async function SettingsPage() {
  await requireAdmin();
  const admin = createAdminClient();
  const { data } = await admin
    .from("bank_instructions")
    .select(
      "bank_name,account_name,account_number,branch,swift_code,instructions",
    )
    .eq("is_active", true)
    .maybeSingle();
  return (
    <>
      <p className="eyebrow">Operational configuration</p>
      <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>Settings</h1>
      {data && (
        <div className="notice">
          Active: {data.bank_name} · {data.account_name} · {data.account_number}
        </div>
      )}
      <div className="card">
        <h2>Receiving bank instructions</h2>
        <BankInstructionsForm />
      </div>
    </>
  );
}
