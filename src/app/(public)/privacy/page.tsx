import type { Metadata } from "next";
export const metadata: Metadata = { title: "Privacy policy" };
export default function PrivacyPage() {
  return (
    <main id="main" className="narrow legal">
      <p className="eyebrow">Version 2026-09-05</p>
      <h1>Privacy policy</h1>
      <p className="legal-banner">
        <strong>Launch gate:</strong> This operational draft must be replaced by
        counsel-approved text before the production domain is promoted.
      </p>
      <h2>Information we use</h2>
      <p>
        OURMU collects application, contact, identity, next-of-kin, investment,
        agreement, and externally verified bank-transfer records needed to
        assess applicants and administer investments.
      </p>
      <h2>Identity protection</h2>
      <p>
        NIN values are encrypted separately from ordinary profile data. Normal
        screens show a mask. Authorized reveals require recent reauthentication
        and create an audit event.
      </p>
      <h2>Retention and rights</h2>
      <p>
        Rejected and abandoned application data is minimized and anonymized
        under the documented retention schedule. Legally significant investment
        and agreement records may remain after account closure. Contact OURMU to
        request access, correction, or closure.
      </p>
    </main>
  );
}
