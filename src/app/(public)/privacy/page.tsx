import type { Metadata } from "next";

import { LEGAL_CONTENT_VERSION } from "@/content/legal";

export const metadata: Metadata = { title: "Privacy policy" };

export default function PrivacyPage() {
  return (
    <main id="main" className="narrow legal">
      <p className="eyebrow">Version {LEGAL_CONTENT_VERSION}</p>
      <h1>Privacy policy</h1>
      <p className="legal-banner">
        <strong>Compliance notice:</strong> This owner-approved version remains
        subject to legal review, PDPO registration, designation of a privacy
        contact, and confirmation of international processing safeguards.
      </p>
      <h2>Who controls your information</h2>
      <p>
        OURMU Ventures Ltd is responsible for personal information collected
        through this portal. Official company information can be verified using
        the Uganda Registration Services Bureau registry. Privacy requests and
        complaints may be sent to{" "}
        <a href="mailto:community@ourmu.org">community@ourmu.org</a>.
      </p>
      <h2>Information we collect</h2>
      <p>
        We collect identification and contact information, including legal name,
        email, phone, date of birth, address, district, country, and National
        Identification Number; application and offline KYC results; beneficiary
        and estate-contact details; investment requests and agreements;
        bank-transfer verification records; closure requests; communications;
        and limited security information such as timestamps, request identifiers,
        user agent, and protected IP fingerprints.
      </p>
      <p>
        This version of the portal does not collect card or mobile-money
        credentials, KYC images, or identity-document scans.
      </p>
      <h2>Why we process it</h2>
      <p>
        We use personal information to issue invitations, assess applications,
        record identity verification, secure accounts, administer private
        investment-club participation, verify bank transfers, create agreements,
        communicate about Projects, meet legal and record-keeping obligations,
        investigate fraud or security events, and resolve closure or privacy
        requests. Processing may rely on consent, pre-contract steps, contract
        performance, or compliance with legal obligations.
      </p>
      <h2>Sharing and international processing</h2>
      <p>
        Information may be accessed by authorised OURMU personnel and vetted
        providers supporting authentication, hosting, database storage, document
        generation, and email. It may also be disclosed to advisers, auditors,
        banks, regulators, or law-enforcement bodies where authorised or
        required. Where information is processed outside Uganda, OURMU will use
        an applicable lawful safeguard or obtain required consent.
      </p>
      <h2>Security</h2>
      <p>
        NIN values are encrypted separately from ordinary profile data. Normal
        screens show only a mask. Protected reveals require recent
        reauthentication and create an audit event. Additional controls include
        administrator MFA, private document storage, row-level database policies,
        restricted administrative access, and append-only audit records.
      </p>
      <h2>Retention</h2>
      <p>
        Approved Member profiles, KYC decisions, investments, bank-transfer
        confirmations, agreements, beneficiary nominations, closure records, and
        audit history are normally retained for five years after the latest of
        the final transaction, termination of the relationship, or resolution of
        a dispute or investigation. Records may be retained longer where required
        by law, a court, a regulator, taxation requirements, or an unresolved
        claim.
      </p>
      <p>
        Unnecessary rejected or abandoned application information is scheduled
        for deletion or anonymisation after 30 days unless law requires longer
        retention. Closing an account disables access but does not erase records
        OURMU must lawfully retain.
      </p>
      <h2>Your rights and complaints</h2>
      <p>
        Subject to applicable law, you may request confirmation of whether OURMU
        holds your data, access, correction, or cessation of certain processing.
        You may object to direct marketing and complain to OURMU or Uganda&apos;s
        Personal Data Protection Office. OURMU may require proof of identity
        before releasing protected information.
      </p>
    </main>
  );
}
