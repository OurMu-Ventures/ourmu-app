import Link from "next/link";

import { ConfirmPrimaryEmailForm } from "@/components/forms";
import { requireInvestor } from "@/lib/auth";
import { dateTime } from "@/lib/format";
import { toBytea } from "@/lib/db";
import { fingerprintRequestValue } from "@/lib/security/crypto";
import { createAdminClient } from "@/lib/supabase/admin";

type ConfirmationStatus =
  | { kind: "invalid" }
  | { kind: "foreign" }
  | { kind: "complete" }
  | { kind: "expired"; expiresAt: string }
  | { kind: "ready"; token: string; newEmail: string; currentEmail: string };

// Read-only lookup: scanners and prefetchers that open the link cannot
// complete the change. Only the Confirm button (a POST with a fresh sign-in)
// finalizes, via the guarded database trigger behind the Auth admin API.
async function loadConfirmation(
  profileId: string,
  profileEmail: string,
  rawToken: unknown,
): Promise<ConfirmationStatus> {
  const token = typeof rawToken === "string" ? rawToken : "";
  if (!token || token.length > 200) return { kind: "invalid" };
  const admin = createAdminClient();
  const { data: request } = await admin
    .from("primary_email_change_requests")
    .select("user_id,new_email,mode,expires_at,finalized_at")
    .eq("token_hash", toBytea(fingerprintRequestValue("account-email", token)))
    .maybeSingle();
  if (!request || request.mode !== "new_address") return { kind: "invalid" };
  if (request.user_id !== profileId) return { kind: "foreign" };
  if (request.finalized_at) return { kind: "complete" };
  if (request.expires_at && new Date(request.expires_at).getTime() <= Date.now())
    return { kind: "expired", expiresAt: request.expires_at };
  return { kind: "ready", token, newEmail: request.new_email, currentEmail: profileEmail };
}

// Deliberate-confirmation page for primary-email changes.
export default async function ConfirmPrimaryEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const profile = await requireInvestor();
  const params = await searchParams;
  const status = await loadConfirmation(profile.id, profile.email, params.token);

  if (status.kind === "foreign") {
    return (
      <>
        <p className="eyebrow">Primary email change</p>
        <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>
          Different account
        </h1>
        <p className="notice">
          This confirmation link belongs to a different account. Sign in with
          the requesting account, then open the link again.
        </p>
      </>
    );
  }
  if (status.kind === "complete") {
    return (
      <>
        <p className="eyebrow">Primary email change</p>
        <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>Already complete</h1>
        <p className="notice">
          This change is already complete. Sign in with your primary email.
        </p>
      </>
    );
  }
  if (status.kind === "expired") {
    return (
      <>
        <p className="eyebrow">Primary email change</p>
        <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>Link expired</h1>
        <p className="notice">
          This confirmation link expired on {dateTime(status.expiresAt)}.
          Request the change again from{" "}
          <Link href="/profile">Profile → Email contacts</Link> for a new link.
        </p>
      </>
    );
  }
  if (status.kind === "ready") {
    return (
      <>
        <p className="eyebrow">Primary email change</p>
        <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>Confirm new email</h1>
        <p className="muted">
          Opening this link changed nothing. The change completes only when you
          choose Confirm below while signed in with a fresh sign-in (issued
          within the last 10 minutes).
        </p>
        <div className="card">
          <ConfirmPrimaryEmailForm
            token={status.token}
            newEmail={status.newEmail}
            currentEmail={status.currentEmail}
          />
        </div>
      </>
    );
  }
  return (
    <>
      <p className="eyebrow">Primary email change</p>
      <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>
        Confirmation link invalid
      </h1>
      <p className="notice">
        This confirmation link is invalid or has already been used. Request
        the change again from <Link href="/profile">Profile → Email contacts</Link> for
        a new link.
      </p>
    </>
  );
}
