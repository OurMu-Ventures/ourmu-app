import { NinReveal } from "@/components/forms";
import { requireAdmin } from "@/lib/auth";
import { maskNin } from "@/lib/security/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
export default async function InvestorsPage() {
  await requireAdmin();
  const admin = createAdminClient();
  const [{ data: profiles }, { data: identities }] = await Promise.all([
    admin
      .from("profiles")
      .select("*")
      .eq("role", "investor")
      .order("created_at", { ascending: false }),
    admin
      .schema("private")
      .from("investor_identities")
      .select("user_id,nin_last_four"),
  ]);
  const masks = new Map(
    (identities ?? []).map((item) => [item.user_id, item.nin_last_four]),
  );
  return (
    <>
      <p className="eyebrow">Investor records</p>
      <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>Investors</h1>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Access</th>
              <th>KYC</th>
              <th>NIN</th>
              <th>Sensitive action</th>
            </tr>
          </thead>
          <tbody>
            {(profiles ?? []).map((item) => (
              <tr key={item.id}>
                <td>{item.legal_name}</td>
                <td>{item.email}</td>
                <td>{item.access_status}</td>
                <td>{item.kyc_status}</td>
                <td>{maskNin(masks.get(item.id) ?? null)}</td>
                <td>
                  <NinReveal userId={item.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
