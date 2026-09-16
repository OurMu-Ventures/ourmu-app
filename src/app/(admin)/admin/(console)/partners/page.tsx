import { LegacyClaimForm } from "@/components/forms";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function PartnersPage() {
  await requireAdmin();
  const admin = createAdminClient();
  const [{ data: profiles }, { data: unclaimed }, { data: accountEmails }] =
    await Promise.all([
      admin
        .from("profiles")
        .select("*")
        .eq("role", "investor")
        .order("created_at", { ascending: false }),
      admin
        .from("legacy_partner_identities")
        .select("id,canonical_name,normalized_phone")
        .is("profile_id", null)
        .order("canonical_name"),
      admin.from("account_emails").select("user_id,email,is_primary,verified_at").eq("is_primary", false).order("created_at"),
    ]);
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
            </tr>
          </thead>
          <tbody>
            {(profiles ?? []).map((item) => (
              <tr key={item.id}>
                <td>{item.legal_name}</td>
                <td>
                  {item.email}
                  {(accountEmails ?? []).filter((email) => email.user_id === item.id).map((email) => (
                    <small className="muted" style={{ display: "block" }} key={email.email}>
                      {email.email} ({email.verified_at ? "verified" : "pending"})
                    </small>
                  ))}
                </td>
                <td>{item.access_status}</td>
                <td>{item.kyc_status}</td>
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
