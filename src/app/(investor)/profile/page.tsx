import { NextOfKinForm, NinReveal } from "@/components/forms";
import { requireInvestor } from "@/lib/auth";
import { maskNin } from "@/lib/security/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export default async function ProfilePage() {
  const profile = await requireInvestor();
  const supabase = await createClient();
  const { data: kin } = await supabase
    .from("next_of_kin")
    .select("*")
    .eq("user_id", profile.id)
    .maybeSingle();
  const admin = createAdminClient();
  const { data: identity } = await admin
    .schema("private")
    .from("investor_identities")
    .select("nin_last_four")
    .eq("user_id", profile.id)
    .maybeSingle();
  return (
    <>
      <p className="eyebrow">Profile and contract contact</p>
      <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>
        {profile.legal_name}
      </h1>
      <div className="grid">
        <article className="card">
          <h2>Contact</h2>
          <p>
            {profile.email}
            <br />
            {profile.phone}
            <br />
            {profile.address}, {profile.district}, {profile.country}
          </p>
        </article>
        <article className="card">
          <h2>Identity</h2>
          <p>
            NIN: <strong>{maskNin(identity?.nin_last_four ?? null)}</strong>
          </p>
          <p className="muted">
            Reveal requires a fresh emailed sign-in (investor) or AAL2
            (administrator) and is audited.
          </p>
          <NinReveal userId={profile.id} />
        </article>
        <article className="card">
          <h2>KYC</h2>
          <p>
            <span className="badge">{profile.kyc_status}</span>
          </p>
          <p className="muted">Verification is performed offline.</p>
        </article>
      </div>
      <section style={{ marginTop: "2rem" }}>
        <h2>Next of kin</h2>
        <div className="card">
          <NextOfKinForm current={kin ?? undefined} />
        </div>
      </section>
    </>
  );
}
