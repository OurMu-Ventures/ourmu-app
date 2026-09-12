import { LegacyClaimForm, NinReveal } from "@/components/forms";
import { requireAdmin } from "@/lib/auth";
import { maskNin } from "@/lib/security/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
export default async function PartnersPage() {
  await requireAdmin();
  const admin = createAdminClient();
  const [{ data: profiles }, { data: identities }, { data: unclaimed }] =
    await Promise.all([
      admin
        .from("profiles")
        .select("*")
        .eq("role", "investor")
        .order("created_at", { ascending: false }),
      admin
        .schema("private")
        .from("investor_identities")
        .select("user_id,nin_last_four"),
      admin
        .from("legacy_partner_identities")
        .select("id,canonical_name,normalized_phone")
        .is("profile_id", null)
        .order("canonical_name"),
    ]);
  const masks = new Map(
    (identities ?? []).map((item) => [item.user_id, item.nin_last_four]),
  );
  return (
    <>
      <p className="eyebrow">Partner records</p>
      <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>Partners</h1>
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
      <section style={{ marginTop: "2rem" }}>
        <h2>Unclaimed imported partners</h2>
        <p className="muted">
          Link only after independently verifying the partner&apos;s email. This
          action requires AAL2 and sends no email.
        </p>
        {(unclaimed ?? []).map((item) => (
          <article
            className="card"
            style={{ marginBottom: "1rem" }}
            key={item.id}
          >
            <h3>{item.canonical_name}</h3>
            <LegacyClaimForm partnerId={item.id} />
          </article>
        ))}
      </section>
    </>
  );
}
