import { NextOfKinForm } from "@/components/forms";
import { requireInvestor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function ProfilePage() {
  const profile = await requireInvestor();
  const supabase = await createClient();
  const { data: kin } = await supabase
    .from("next_of_kin")
    .select("*")
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
          <h2>KYC</h2>
          <p>
            <span className="badge">{profile.kyc_status}</span>
          </p>
          <p className="muted">Verification is performed offline.</p>
        </article>
      </div>
      <section style={{ marginTop: "2rem" }}>
        <h2>Beneficiary and estate contact</h2>
        <p className="muted">
          This person is your intended beneficiary and estate contact. Any
          release remains subject to applicable succession law and proof of
          authority.
        </p>
        <div className="card">
          <NextOfKinForm current={kin ?? undefined} />
        </div>
      </section>
    </>
  );
}
