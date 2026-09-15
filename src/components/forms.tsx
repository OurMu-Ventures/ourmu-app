"use client";

import { useActionState, useState } from "react";
import { ExternalLink } from "lucide-react";
import Link from "next/link";

import {
  createAgreementVersion,
  createCycle,
  acceptPartnerImport,
  claimLegacyPartner,
  saveBankInstructions,
  updateCycle,
} from "@/actions/admin";
import {
  approveApplication,
  createInvitation,
  rejectApplication,
  submitApplication,
} from "@/actions/applications";
import { requestMagicLink, signInTestAccount } from "@/actions/auth";
import { activateInvestment, requestInvestment } from "@/actions/investments";
import { requestAccountClosure, saveNextOfKin } from "@/actions/profile";
import { ActionButton } from "@/components/ActionButton";
import { StateMessage } from "@/components/StateMessage";
import { Button } from "@/components/ui/button";
import {
  AGREEMENT_TEMPLATE,
  AGREEMENT_TITLE,
  LEGAL_CONTENT_VERSION,
} from "@/content/legal";
import { initialActionState } from "@/lib/validation";

export function MagicLinkForm({ next }: { next?: string }) {
  const [state, action] = useActionState(requestMagicLink, initialActionState);
  return (
    <form className="form" action={action}>
      {typeof next === "string" && next.length > 0 && (
        <input type="hidden" name="next" value={next} />
      )}
      <label>
        Email address
        <input name="email" type="email" autoComplete="email" required />
      </label>
      <ActionButton>Email me a secure link</ActionButton>
      <StateMessage state={state} />
    </form>
  );
}

export function TestAccountLoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState(
    signInTestAccount,
    initialActionState,
  );
  return (
    <form className="form" action={action}>
      {typeof next === "string" && next.length > 0 && (
        <input type="hidden" name="next" value={next} />
      )}
      <label>
        Test account email
        <input name="email" type="email" autoComplete="username" required />
      </label>
      <label>
        Password
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          minLength={12}
          required
        />
      </label>
      <ActionButton>Sign in to test account</ActionButton>
      <StateMessage state={state} />
    </form>
  );
}

export function ApplicationForm({
  token,
  email,
  privacyVersion,
}: {
  token: string;
  email: string;
  privacyVersion: string;
}) {
  const [state, action] = useActionState(
    submitApplication.bind(null, token),
    initialActionState,
  );
  return (
    <form className="form" action={action}>
      <div className="form-grid">
        <label>
          Legal name
          <input name="legalName" autoComplete="name" required />
        </label>
        <label>
          Email
          <input name="email" type="email" value={email} readOnly />
        </label>
        <label>
          Phone
          <input name="phone" type="tel" autoComplete="tel" required />
        </label>
        <label>
          Date of birth
          <input name="dateOfBirth" type="date" autoComplete="bday" required />
        </label>
        <label>
          National Identification Number
          <input name="nin" autoComplete="off" required />
          <small className="muted">
            Encrypted before storage; normally displayed only as a mask.
          </small>
        </label>
        <label>
          District
          <input name="district" required />
        </label>
        <label>
          Country
          <input name="country" defaultValue="Uganda" required />
        </label>
        <label>
          Residential address
          <textarea name="address" autoComplete="street-address" required />
        </label>
      </div>
      <label className="checkbox">
        <input name="consent" type="checkbox" value="yes" required />
        <span>
          I consent to processing under privacy policy version {privacyVersion}.
        </span>
      </label>
      <ActionButton>Submit private application</ActionButton>
      <StateMessage state={state} />
    </form>
  );
}

export function InvitationForm() {
  const [state, action] = useActionState(createInvitation, initialActionState);
  return (
    <form className="form" action={action}>
      <label>
        Invited email
        <input name="email" type="email" required />
      </label>
      <ActionButton>Issue seven-day invitation</ActionButton>
      <StateMessage state={state} />
    </form>
  );
}

export function DecisionForm({
  applicationId,
  decision,
}: {
  applicationId: string;
  decision: "approve" | "reject";
}) {
  const handler =
    decision === "approve" ? approveApplication : rejectApplication;
  const [state, action] = useActionState(handler, initialActionState);
  return (
    <form className="form" action={action}>
      <input type="hidden" name="applicationId" value={applicationId} />
      <label>
        Offline verification reference
        <input name="verificationReference" required />
      </label>
      <label>
        Non-sensitive notes
        <textarea name="notes" />
      </label>
      <ActionButton danger={decision === "reject"}>
        {decision === "approve"
          ? "Approve and send magic link"
          : "Reject and erase NIN"}
      </ActionButton>
      <StateMessage state={state} />
    </form>
  );
}

export function NextOfKinForm({
  current,
}: {
  current?: Record<string, string | null>;
}) {
  const [state, action] = useActionState(saveNextOfKin, initialActionState);
  return (
    <form className="form" action={action}>
      <div className="form-grid">
        <label>
          Legal name
          <input
            name="legalName"
            defaultValue={current?.legal_name ?? ""}
            required
          />
        </label>
        <label>
          Relationship
          <input
            name="relationship"
            defaultValue={current?.relationship ?? ""}
            required
          />
        </label>
        <label>
          Phone
          <input
            name="phone"
            type="tel"
            defaultValue={current?.phone ?? ""}
            required
          />
        </label>
        <label>
          Email (optional)
          <input
            name="email"
            type="email"
            defaultValue={current?.email ?? ""}
          />
        </label>
      </div>
      <label>
        Address
        <textarea
          name="address"
          defaultValue={current?.address ?? ""}
          required
        />
      </label>
      <ActionButton>Save beneficiary contact</ActionButton>
      <StateMessage state={state} />
    </form>
  );
}

export function InvestmentRequestForm({
  cycleId,
  agreementId,
  agreementTitle,
}: {
  cycleId: string;
  agreementId: string;
  agreementTitle: string;
}) {
  const [state, action] = useActionState(requestInvestment, initialActionState);
  return (
    <form className="form" action={action}>
      <input type="hidden" name="cycleId" value={cycleId} />
      <label>
        Investment amount (UGX)
        <input
          name="principalUgx"
          type="number"
          min="125000"
          max="62500000"
          step="0.01"
          defaultValue="125000"
          required
        />
        <small className="muted">
          Minimum UGX 125,000. Fractional units are calculated automatically.
        </small>
      </label>
      <label className="checkbox">
        <input name="agreementAccepted" type="checkbox" value="yes" required />
        <span>
          I have read and accept the{" "}
          <Link
            aria-label={`${agreementTitle} (opens in a new tab)`}
            className="agreement-acceptance-link"
            href={`/participation-agreements/${agreementId}`}
            target="_blank"
            rel="noreferrer"
          >
            <span>{agreementTitle}</span>
            <ExternalLink aria-hidden="true" size={15} strokeWidth={2.5} />
          </Link>
          . This records a legally significant acceptance receipt.
        </span>
      </label>
      <ActionButton>Reserve investment for 48 hours</ActionButton>
      <StateMessage state={state} />
    </form>
  );
}

export function ActivationForm({
  investmentId,
  expectedAmount,
}: {
  investmentId: string;
  expectedAmount: number;
}) {
  const [state, action] = useActionState(
    activateInvestment,
    initialActionState,
  );
  return (
    <form className="form" action={action}>
      <input type="hidden" name="investmentId" value={investmentId} />
      <label>
        Bank reference
        <input name="bankReference" autoComplete="off" required />
      </label>
      <label>
        Exact amount received (UGX)
        <input
          name="receivedAmountUgx"
          type="number"
          step="0.00000001"
          defaultValue={expectedAmount}
          required
        />
      </label>
      <label>
        Received date
        <input name="receivedDate" type="date" required />
      </label>
      <label>
        Type ACTIVATE
        <input name="confirmation" autoComplete="off" required />
      </label>
      <ActionButton>Activate investment</ActionButton>
      <StateMessage state={state} />
    </form>
  );
}

export function ImportAcceptanceForm({ batchId }: { batchId: string }) {
  const [state, action] = useActionState(
    acceptPartnerImport,
    initialActionState,
  );
  return (
    <form className="form" action={action}>
      <input type="hidden" name="batchId" value={batchId} />
      <label>
        Type ACCEPT IMPORT
        <input name="confirmation" autoComplete="off" required />
      </label>
      <ActionButton>Accept reconciled import</ActionButton>
      <StateMessage state={state} />
    </form>
  );
}

export function LegacyClaimForm({ partnerId }: { partnerId: string }) {
  const [state, action] = useActionState(
    claimLegacyPartner,
    initialActionState,
  );
  return (
    <form className="form" action={action}>
      <input type="hidden" name="partnerId" value={partnerId} />
      <label>
        Verified email
        <input name="email" type="email" required />
      </label>
      <label>
        Phone (optional)
        <input name="phone" type="tel" />
      </label>
      <label>
        Type LINK PARTNER
        <input name="confirmation" autoComplete="off" required />
      </label>
      <ActionButton>Link login without emailing</ActionButton>
      <StateMessage state={state} />
    </form>
  );
}

export function ClosureForm() {
  const [state, action] = useActionState(
    requestAccountClosure,
    initialActionState,
  );
  return (
    <form className="form" action={action}>
      <label>
        Reason (optional)
        <textarea name="reason" maxLength={1000} />
      </label>
      <p className="notice">
        Submitting disables portal access immediately. Financial and agreement
        records remain retained as legally required.
      </p>
      <ActionButton danger>Disable access and request closure</ActionButton>
      <StateMessage state={state} />
    </form>
  );
}

export function AgreementVersionForm() {
  const [state, action] = useActionState(
    createAgreementVersion,
    initialActionState,
  );
  return (
    <form className="form" action={action}>
      <label>
        Version
        <input name="version" defaultValue={LEGAL_CONTENT_VERSION} required />
      </label>
      <label>
        Agreement title
        <input name="title" defaultValue={AGREEMENT_TITLE} required />
      </label>
      <label>
        Approved template
        <textarea
          name="template"
          minLength={500}
          defaultValue={AGREEMENT_TEMPLATE}
          rows={24}
          required
        />
      </label>
      <label className="checkbox">
        <input name="legalConfirmation" type="checkbox" value="yes" required />
        <span>
          I confirm legal counsel approved this exact text for publication.
        </span>
      </label>
      <ActionButton>Publish immutable version</ActionButton>
      <StateMessage state={state} />
    </form>
  );
}

export function CycleForm({
  agreements,
}: {
  agreements: { id: string; title: string; version: string }[];
}) {
  const [state, action] = useActionState(createCycle, initialActionState);
  return (
    <form className="form" action={action}>
      <label>
        Name
        <input name="name" required />
      </label>
      <div className="form-grid">
        <label>
          Opens at
          <input name="opensAt" type="datetime-local" required />
        </label>
        <label>
          Closes at
          <input name="closesAt" type="datetime-local" required />
        </label>
        <label>
          Maturity date
          <input name="maturityDate" type="date" required />
        </label>
        <label>
          Capacity (UGX)
          <input
            name="capacityUgx"
            type="number"
            min="125000"
            step="0.01"
            required
          />
        </label>
      </div>
      <label>
        Agreement
        <select name="agreementVersionId" required>
          <option value="">Select…</option>
          {agreements.map((a) => (
            <option key={a.id} value={a.id}>
              {a.version} · {a.title}
            </option>
          ))}
        </select>
      </label>
      <ActionButton>Create draft cycle</ActionButton>
      <StateMessage state={state} />
    </form>
  );
}

export function CycleEditForm({
  cycle,
  agreements,
}: {
  cycle: {
    id: string;
    name: string;
    opens_at: string;
    closes_at: string;
    maturity_date: string;
    capacity_ugx: number | string | null;
    agreement_version_id: string | null;
  };
  agreements: { id: string; title: string; version: string }[];
}) {
  const [state, action] = useActionState(updateCycle, initialActionState);
  const local = (value: string) =>
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Africa/Kampala",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .format(new Date(value))
      .replace(" ", "T");
  return (
    <form className="form" action={action}>
      <input type="hidden" name="cycleId" value={cycle.id} />
      <label>
        Name
        <input name="name" defaultValue={cycle.name} required />
      </label>
      <div className="form-grid">
        <label>
          Opens at (Kampala)
          <input
            name="opensAt"
            type="datetime-local"
            defaultValue={local(cycle.opens_at)}
            required
          />
        </label>
        <label>
          Closes at (Kampala)
          <input
            name="closesAt"
            type="datetime-local"
            defaultValue={local(cycle.closes_at)}
            required
          />
        </label>
        <label>
          Maturity date
          <input
            name="maturityDate"
            type="date"
            defaultValue={cycle.maturity_date}
            required
          />
        </label>
        <label>
          Capacity (UGX)
          <input
            name="capacityUgx"
            type="number"
            min="125000"
            step="0.01"
            defaultValue={cycle.capacity_ugx ?? ""}
            required
          />
        </label>
      </div>
      <label>
        Agreement
        <select
          name="agreementVersionId"
          defaultValue={cycle.agreement_version_id ?? ""}
          required
        >
          {agreements.map((a) => (
            <option key={a.id} value={a.id}>
              {a.version} · {a.title}
            </option>
          ))}
        </select>
      </label>
      <ActionButton>Save draft</ActionButton>
      <StateMessage state={state} />
    </form>
  );
}

export function BankInstructionsForm() {
  const [state, action] = useActionState(
    saveBankInstructions,
    initialActionState,
  );
  return (
    <form className="form" action={action}>
      <div className="form-grid">
        <label>
          Bank name
          <input name="bankName" required />
        </label>
        <label>
          Account name
          <input name="accountName" required />
        </label>
        <label>
          Account number
          <input name="accountNumber" required />
        </label>
        <label>
          Branch
          <input name="branch" />
        </label>
        <label>
          SWIFT code
          <input name="swiftCode" />
        </label>
      </div>
      <label>
        Transfer instructions
        <textarea name="instructions" required />
      </label>
      <ActionButton>Activate these instructions</ActionButton>
      <StateMessage state={state} />
    </form>
  );
}

export function Tabs({
  labels,
  children,
}: {
  labels: string[];
  children: React.ReactNode[];
}) {
  const [active, setActive] = useState(0);
  return (
    <div>
      <div className="hero-actions" role="tablist">
        {labels.map((label, index) => (
          <Button
            variant={active === index ? "default" : "secondary"}
            type="button"
            role="tab"
            aria-selected={active === index}
            onClick={() => setActive(index)}
            key={label}
          >
            {label}
          </Button>
        ))}
      </div>
      <div role="tabpanel" className="card" style={{ marginTop: "1rem" }}>
        {children[active]}
      </div>
    </div>
  );
}
