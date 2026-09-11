import type { Metadata } from "next";
import { FishExperience } from "@/components/FishExperience";
import { MagicLinkForm } from "@/components/forms";

export const metadata: Metadata = { title: "Partner login" };
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ disabled?: string }>;
}) {
  const params = await searchParams;
  return (
    <main id="main">
      <section className="container hero">
        <div>
          <p className="eyebrow">Approved partners</p>
          <h1>Sign in without a password.</h1>
          <p className="lead">
            We will email a time-limited magic link to an approved account.
            Unrestricted sign-up is disabled.
          </p>
          {params.disabled && (
            <p className="error">
              This account does not currently have portal access.
            </p>
          )}
          <div className="card">
            <MagicLinkForm />
          </div>
        </div>
        <FishExperience />
      </section>
    </main>
  );
}
