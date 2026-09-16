import type { Metadata } from "next";

import { FishExperience } from "@/components/FishExperience";
import { MagicLinkForm } from "@/components/forms";
import { LOGIN_ERROR_MESSAGES, parseLoginError } from "@/lib/redirect";

export const metadata: Metadata = { title: "Partner login" };
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ disabled?: string; error?: string; next?: string; contact?: string }>;
}) {
  const params = await searchParams;
  const errorCode = parseLoginError(params.error);
  // The requested destination is opaque here: it is validated in the login
  // action and re-validated at the callback, never rendered as content.
  const next = typeof params.next === "string" ? params.next : undefined;
  return (
    <main id="main">
      <section className="container hero">
        <div>
          <p className="eyebrow">Approved partners</p>
          <h1>Sign in to your portal.</h1>
          <p className="lead">
            We will email a time-limited magic link to an approved account.
          </p>
          {(params.disabled || errorCode) && (
            <p className="error" role="alert">
              {errorCode
                ? LOGIN_ERROR_MESSAGES[errorCode]
                : "This account does not currently have portal access."}
            </p>
          )}
          {params.contact === "verified" && (
            <p className="success" role="status">Your additional email is verified. You can now sign in with it.</p>
          )}
          {params.contact === "invalid" && (
            <p className="error" role="alert">That email verification link is invalid or has expired.</p>
          )}
          <div className="card">
            <MagicLinkForm next={next} />
          </div>
        </div>
        <FishExperience />
      </section>
    </main>
  );
}
