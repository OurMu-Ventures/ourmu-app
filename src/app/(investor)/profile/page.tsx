import { AccountEmailsPanel, NextOfKinForm } from "@/components/forms";
import {
  StandingTermsAcceptForm,
  StandingTermsRevokeForm,
} from "@/components/maturity-forms";
import { requireInvestor } from "@/lib/auth";
import { dateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export default async function ProfilePage() {
  const profile = await requireInvestor();
  const supabase = await createClient();
  const { data: kin } = await supabase
    .from("next_of_kin")
    .select("*")
    .eq("user_id", profile.id)
    .maybeSingle();
  const { data: accountEmails } = await supabase
    .from("account_emails")
    .select("id,email,is_primary,verified_at")
    .eq("user_id", profile.id)
    .order("is_primary", { ascending: false })
    .order("created_at");
  const [{ data: standingAuth }, { data: standingAgreements }] =
    await Promise.all([
      supabase
        .from("maturity_reinvest_authorizations")
        .select("id,authorized_at,revoked_at,agreement_versions(version,title)")
        .eq("investor_id", profile.id)
        .eq("scope", "all_portal")
        .maybeSingle(),
      supabase
        .from("agreement_versions")
        .select("id,version,title")
        .eq("is_legally_approved", true)
        .not("published_at", "is", null)
        .order("published_at", { ascending: false }),
    ]);
  const standingVersion = Array.isArray(standingAuth?.agreement_versions)
    ? standingAuth.agreement_versions[0]
    : standingAuth?.agreement_versions;
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
        <h2>Email contacts</h2>
        <p className="muted">Verified contacts receive account notifications and can request a secure sign-in link. Your primary email remains unchanged.</p>
        <div className="card"><AccountEmailsPanel emails={accountEmails ?? []} /></div>
      </section>
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
      <section style={{ marginTop: "2rem" }}>
        <h2>Standing reinvest authorization</h2>
        <p className="muted">
          Authorize automatic full reinvestment of unanswered maturities
          under one approved terms version. A rollover completes only while
          this authorization is live and the destination cycle runs on these
          exact terms; anything else needs your explicit choice.
        </p>
        <div className="card">
          {standingAuth && !standingAuth.revoked_at ? (
            <>
              <p>
                Active since{" "}
                <strong>{dateTime(standingAuth.authorized_at)}</strong> under{" "}
                <strong>
                  {standingVersion?.version} · {standingVersion?.title}
                </strong>
                .
              </p>
              <StandingTermsRevokeForm />
            </>
          ) : (
            <StandingTermsAcceptForm agreements={standingAgreements ?? []} />
          )}
        </div>
      </section>
    </>
  );
}
