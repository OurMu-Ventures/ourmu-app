import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ApplicationForm } from "@/components/forms";
import { toBytea } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import { fingerprintRequestValue } from "@/lib/security/crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = {
  title: "Private application",
  robots: { index: false, follow: false },
};
export default async function ApplyPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const admin = createAdminClient();
  const hash = toBytea(fingerprintRequestValue("invite", token));
  const { data } = await admin
    .from("application_invitations")
    .select("invited_email,expires_at,used_at,revoked_at")
    .eq("token_hash", hash)
    .maybeSingle();
  if (
    !data ||
    data.used_at ||
    data.revoked_at ||
    new Date(data.expires_at) <= new Date()
  )
    notFound();
  return (
    <main id="main" className="narrow">
      <p className="eyebrow">Confidential application</p>
      <h1>Apply to become an OURMU partner.</h1>
      <p className="lead">
        Your email is fixed to this invitation. KYC review happens offline; do
        not upload identity documents.
      </p>
      <div className="card">
        <ApplicationForm
          token={token}
          email={data.invited_email}
          privacyVersion={getServerEnv().LEGAL_PRIVACY_VERSION}
        />
      </div>
    </main>
  );
}
