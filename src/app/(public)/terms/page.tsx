import type { Metadata } from "next";
export const metadata: Metadata = { title: "Terms" };
export default function TermsPage() {
  return (
    <main id="main" className="narrow legal">
      <h1>Portal terms</h1>
      <p className="legal-banner">
        <strong>Launch gate:</strong> Counsel approval is required before
        production promotion.
      </p>
      <p>
        The portal is a record-keeping and communication service for invited,
        approved investors. It is not a payment processor and does not itself
        receive, transmit, or custody money.
      </p>
      <h2>Authorized use</h2>
      <p>
        Keep magic links private, maintain accurate profile information, and
        report suspected unauthorized access. Investment requests remain subject
        to capacity, bank verification, and the applicable approved agreement.
      </p>
      <h2>Electronic records</h2>
      <p>
        Submitting an investment request records acceptance of the identified
        agreement version, content hash, time, and security context.
      </p>
    </main>
  );
}
