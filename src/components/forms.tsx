"use client";

import { useActionState, useState } from "react";

import {
  createAgreementVersion,
  createCycle,
  revealNin,
  saveBankInstructions,
  updateCycle,
  type RevealState,
} from "@/actions/admin";
import {
  approveApplication,
  createInvitation,
  rejectApplication,
  submitApplication,
} from "@/actions/applications";
import { requestMagicLink } from "@/actions/auth";
import { activateInvestment, requestInvestment } from "@/actions/investments";
import { requestAccountClosure, saveNextOfKin } from "@/actions/profile";
import { ActionButton } from "@/components/ActionButton";
import { StateMessage } from "@/components/StateMessage";
import {
  AGREEMENT_TEMPLATE,
  AGREEMENT_TITLE,
  LEGAL_CONTENT_VERSION,
} from "@/content/legal";
import { initialActionState } from "@/lib/validation";

export function MagicLinkForm() {
  const [state, action] = useActionState(requestMagicLink, initialActionState);
  return (
    <form className="form" action={action}>
      <label>
        Email address
        <input name="email" type="email" autoComplete="email" required />
      </label>
      <ActionButton>Email me a secure link</ActionButton>
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
  agreementTitle,
}: {
  cycleId: string;
  agreementTitle: string;
}) {
  const [state, action] = useActionState(requestInvestment, initialActionState);
  return (
    <form className="form" action={action}>
      <input type="hidden" name="cycleId" value={cycleId} />
      <label>
        Units (1–500)
        <input
          name="units"
          type="number"
          min="1"
          max="500"
          defaultValue="1"
          required
        />
      </label>
      <label className="checkbox">
        <input name="agreementAccepted" type="checkbox" value="yes" required />
        <span>
          I have read and accept “{agreementTitle}”. This records a legally
          significant acceptance receipt.
        </span>
      </label>
      <ActionButton>Reserve units for 48 hours</ActionButton>
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
          Capacity units
          <input name="capacityUnits" type="number" min="1" required />
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
    capacity_units: number;
    agreement_version_id: string;
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
          Capacity units
          <input
            name="capacityUnits"
            type="number"
            min="1"
            defaultValue={cycle.capacity_units}
            required
          />
        </label>
      </div>
      <label>
        Agreement
        <select
          name="agreementVersionId"
          defaultValue={cycle.agreement_version_id}
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

export function NinReveal({ userId }: { userId: string }) {
  const [state, action] = useActionState(revealNin, {
    ok: false,
    message: "",
  } satisfies RevealState);
  return (
    <form action={action}>
      <input type="hidden" name="userId" value={userId} />
      <ActionButton>Reveal NIN once</ActionButton>
      {state.message && (
        <p className={state.ok ? "notice" : "error"} role="status">
          {state.message}
        </p>
      )}
      {state.value && (
        <output className="card" aria-live="polite">
          <strong>{state.value}</strong>
        </output>
      )}
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
          <button
            className={active === index ? "button" : "button-secondary"}
            type="button"
            role="tab"
            aria-selected={active === index}
            onClick={() => setActive(index)}
            key={label}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="card" style={{ marginTop: "1rem" }}>
        {children[active]}
      </div>
    </div>
  );
}
