import type { Metadata } from "next";

import { LEGAL_CONTENT_VERSION } from "@/content/legal";

export const metadata: Metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <main id="main" className="narrow legal">
      <p className="eyebrow">Version {LEGAL_CONTENT_VERSION}</p>
      <h1>Portal terms</h1>
      <p className="legal-banner">
        <strong>Compliance notice:</strong> These owner-approved terms remain
        subject to legal review before broader enrolment.
      </p>
      <p>
        The portal is a record-keeping and communication service for invited,
        approved members of a private investment-club arrangement administered
        by OURMU Ventures Ltd. It is not a payment processor and does not itself
        receive, transmit, or custody money. Project Units are not shares in
        OURMU Ventures Ltd and do not grant authority to bind the company.
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
        agreement, Privacy Policy, and Risk Disclosure versions, together with
        the content hash, time, and limited security context. Electronic
        acceptance is intended to be legally binding.
      </p>
      <h2>Beneficiary and estate contact</h2>
      <p>
        A nominated next of kin is the intended beneficiary and estate contact
        for amounts payable after death. Release remains subject to proof of
        authority, succession law, valid estate documents, and lawful court
        orders.
      </p>
      <h2>Complaints and governing law</h2>
      <p>
        Send complaints to{" "}
        <a href="mailto:community@ourmu.org">community@ourmu.org</a>. OURMU will
        provide a substantive response within 10 business days or explain why
        more time is reasonably required. These terms are governed by Ugandan
        law, and unresolved disputes may be brought before a court of competent
        jurisdiction in Uganda.
      </p>
    </main>
  );
}
