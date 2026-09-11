import type { Metadata } from "next";

import { LEGAL_CONTENT_VERSION } from "@/content/legal";

export const metadata: Metadata = { title: "Risk disclosure" };

export default function RiskPage() {
  return (
    <main id="main" className="narrow legal">
      <p className="eyebrow">Version {LEGAL_CONTENT_VERSION}</p>
      <h1>Investment risk disclosure</h1>
      <p className="legal-banner">
        <strong>Compliance notice:</strong> This owner-approved version remains
        subject to legal and regulatory review before broader enrolment.
      </p>
      <h2>Projected return</h2>
      <p>
        The displayed 30% return is a projection, not a guarantee. Actual return
        may be below 30%, including zero. Past Project performance does not
        guarantee future performance.
      </p>
      <h2>Principal guarantee and counterparty risk</h2>
      <p>
        OURMU Ventures Ltd contractually guarantees repayment of activated
        principal on the fixed maturity date. This is not a bank deposit,
        insurance policy, or government-backed protection. The guarantee depends
        on OURMU&apos;s ability to perform and may require enforcement through the
        courts of Uganda if OURMU defaults.
      </p>
      <h2>Illiquidity and concentration</h2>
      <p>
        Activated Project Units cannot ordinarily be withdrawn or transferred
        before maturity, and there is no public or secondary market. Each Unit is
        concentrated in a particular farming cycle and is not a diversified
        portfolio.
      </p>
      <h2>Aquaculture and commercial risks</h2>
      <p>
        Operations may be affected by fish mortality, disease, feed supply and
        cost, water quality, adverse weather, flooding, drought, theft,
        biosecurity events, equipment failure, and farm-management problems.
        Suppliers, farmers, transporters, buyers, and off-takers may fail to
        perform. Harvest volumes, demand, and sale prices may differ from
        forecasts.
      </p>
      <h2>Legal, tax, and technology risks</h2>
      <p>
        Changes in laws, permits, taxation, or regulatory treatment may affect
        Project operations or amounts payable. Banking, portal, or communications
        failures may delay confirmations or information. Members remain
        responsible for personal tax obligations, subject to statutory deductions
        or reporting by OURMU.
      </p>
      <h2>Independent consideration</h2>
      <p>
        Participate only with money you can commit for the entire Project period.
        Review the applicable agreement and consider obtaining independent legal,
        tax, or financial advice before requesting Units.
      </p>
    </main>
  );
}
