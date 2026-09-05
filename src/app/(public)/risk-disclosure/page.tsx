import type { Metadata } from "next";
export const metadata: Metadata = { title: "Risk disclosure" };
export default function RiskPage() {
  return (
    <main id="main" className="narrow legal">
      <h1>Investment risk disclosure</h1>
      <p className="legal-banner">
        <strong>Launch gate:</strong> This summary is not the final legally
        approved disclosure.
      </p>
      <p>
        Investing involves risk, including partial or total loss of principal,
        illiquidity, operational and biological risks, market-price changes,
        regulatory change, and delays. The displayed 30% return is a projection
        under cycle terms—not a guarantee of actual return or payment.
      </p>
      <p>
        Do not invest money you cannot afford to lose. Review the complete cycle
        agreement and seek independent financial, tax, and legal advice before
        requesting units.
      </p>
    </main>
  );
}
