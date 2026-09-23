"use client";

import { useActionState, useState } from "react";
import { ExternalLink } from "lucide-react";
import Link from "next/link";

import {
  acceptStandingTerms,
  confirmMaturityAmounts,
  fulfillMaturityInstruction,
  reopenMaturityInstruction,
  revokeStandingTerms,
  submitMaturityInstruction,
} from "@/actions/maturity";
import { ActionButton } from "@/components/ActionButton";
import { StateMessage } from "@/components/StateMessage";
import { ugx } from "@/lib/format";
import {
  MATURITY_CHOICES,
  maturitySplits,
  type MaturityChoice,
} from "@/lib/maturity";
import { initialActionState } from "@/lib/validation";

export type SavedDestination = {
  id: string;
  channel: string;
  provider_label: string;
  account_name: string;
  account_last_four: string | null;
};

export type OpenCycleOption = {
  id: string;
  name: string;
  agreement_version_id: string;
  agreement_title: string;
};

export function MaturityInstructionForm({
  investmentId,
  principalUgx,
  projectedReturnUgx,
  savedDestinations,
  openCycles,
  existingChoice,
  isRevision,
}: {
  investmentId: string;
  principalUgx: number;
  projectedReturnUgx: number;
  savedDestinations: SavedDestination[];
  openCycles: OpenCycleOption[];
  existingChoice?: MaturityChoice;
  isRevision: boolean;
}) {
  const [state, action] = useActionState(
    submitMaturityInstruction,
    initialActionState,
  );
  const [choice, setChoice] = useState<MaturityChoice | "">(
    existingChoice ?? "",
  );
  const [useSaved, setUseSaved] = useState(savedDestinations.length > 0);
  const [targetCycleId, setTargetCycleId] = useState("");
  const needsPayout =
    choice === "withdraw_all" || choice === "withdraw_roi_reinvest_principal";
  const needsReinvest =
    choice === "withdraw_roi_reinvest_principal" || choice === "reinvest_all";
  const selectedCycle = openCycles.find((cycle) => cycle.id === targetCycleId);

  return (
    <form className="form" action={action}>
      <input type="hidden" name="investmentId" value={investmentId} />
      <fieldset>
        <legend>Your maturity choice</legend>
        {MATURITY_CHOICES.map((option) => {
          const splits = maturitySplits(
            principalUgx,
            projectedReturnUgx,
            option.value,
          );
          return (
            <label className="checkbox" key={option.value}>
              <input
                type="radio"
                name="choice"
                value={option.value}
                checked={choice === option.value}
                onChange={() => setChoice(option.value)}
                required
              />
              <span>
                <strong>{option.label}</strong> — {option.description}
                <br />
                <small className="muted">
                  Projected payout {ugx(splits.payoutUgx)} · projected
                  reinvestment {ugx(splits.reinvestUgx)}
                </small>
              </span>
            </label>
          );
        })}
      </fieldset>

      {needsPayout && (
        <fieldset>
          <legend>Where should the payout go?</legend>
          {savedDestinations.length > 0 && (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={useSaved}
                onChange={(event) => setUseSaved(event.target.checked)}
              />
              <span>Use a saved destination</span>
            </label>
          )}
          {useSaved && savedDestinations.length > 0 ? (
            <label>
              Saved destination
              <select name="payoutDestinationId" required>
                {savedDestinations.map((destination) => (
                  <option key={destination.id} value={destination.id}>
                    {destination.channel === "bank" ? "Bank" : "Mobile money"} ·{" "}
                    {destination.provider_label} · {destination.account_name} ·
                    •••• {destination.account_last_four ?? "****"}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="form-grid">
              <label>
                Channel
                <select name="channel" required={!useSaved}>
                  <option value="">Select…</option>
                  <option value="bank">Bank</option>
                  <option value="mobile_money">Mobile money</option>
                </select>
              </label>
              <label>
                Bank or network
                <input name="providerLabel" autoComplete="off" />
              </label>
              <label>
                Account name
                <input name="accountName" autoComplete="off" />
              </label>
              <label>
                Account number or wallet
                <input name="accountReference" autoComplete="off" />
              </label>
            </div>
          )}
          <p className="muted">
            <small>
              Saved for future use. Only you and authorized admins can see these
              details.
            </small>
          </p>
          <label className="checkbox">
            <input
              name="destinationConfirmed"
              type="checkbox"
              value="yes"
              required
            />
            <span>I confirm this payout destination is correct.</span>
          </label>
        </fieldset>
      )}

      {needsReinvest && (
        <fieldset>
          <legend>Reinvestment destination</legend>
          <label>
            Destination cycle
            <select
              name="targetCycleId"
              required
              value={targetCycleId}
              onChange={(event) => setTargetCycleId(event.target.value)}
            >
              <option value="">Select…</option>
              {openCycles.map((cycle) => (
                <option key={cycle.id} value={cycle.id}>
                  {cycle.name}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox">
            <input
              name="agreementAccepted"
              type="checkbox"
              value="yes"
              required
            />
            <span>
              I have read and accept the{" "}
              {selectedCycle ? (
                <Link
                  aria-label={`${selectedCycle.agreement_title} (opens in a new tab)`}
                  className="agreement-acceptance-link"
                  href={`/participation-agreements/${selectedCycle.agreement_version_id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span>{selectedCycle.agreement_title}</span>
                  <ExternalLink
                    aria-hidden="true"
                    size={15}
                    strokeWidth={2.5}
                  />
                </Link>
              ) : (
                "destination cycle’s current agreement"
              )}
              . This records a legally significant acceptance receipt.
            </span>
          </label>
        </fieldset>
      )}

      <ActionButton>
        {isRevision ? "Revise maturity choice" : "Record maturity choice"}
      </ActionButton>
      <StateMessage state={state} />
    </form>
  );
}

export function MaturityFulfillmentForm({
  instructionId,
  needsPayout,
}: {
  instructionId: string;
  needsPayout: boolean;
}) {
  const [state, action] = useActionState(
    fulfillMaturityInstruction,
    initialActionState,
  );
  return (
    <form className="form" action={action}>
      <input type="hidden" name="instructionId" value={instructionId} />
      <div className="form-grid">
        <label>
          Actual ROI (UGX)
          <input
            name="actualRoiUgx"
            type="number"
            min="0"
            step="0.01"
            required
          />
          <small className="muted">
            Record the actual return from the fund. The projected figure is
            never proof of cash. If it differs from the projection, the partner
            must confirm the new amounts before anything moves.
          </small>
        </label>
        {needsPayout && (
          <label>
            External payout reference
            <input name="payoutReference" autoComplete="off" required />
          </label>
        )}
      </div>
      {needsPayout && (
        <label className="checkbox">
          <input
            name="destinationVerified"
            type="checkbox"
            value="yes"
            required
          />
          <span>
            I have opened the revealed payout destination below and verified it
            matches the external transfer.
          </span>
        </label>
      )}
      <label>
        Type FULFILL
        <input name="confirmation" autoComplete="off" required />
      </label>
      <ActionButton>Fulfill instruction</ActionButton>
      <StateMessage state={state} />
    </form>
  );
}

export function MaturityConfirmAmountsForm({
  instructionId,
  proposedRoiUgx,
  proposedPayoutUgx,
  proposedReinvestUgx,
}: {
  instructionId: string;
  proposedRoiUgx: number;
  proposedPayoutUgx: number;
  proposedReinvestUgx: number;
}) {
  const [state, action] = useActionState(
    confirmMaturityAmounts,
    initialActionState,
  );
  return (
    <form className="form" action={action}>
      <input type="hidden" name="instructionId" value={instructionId} />
      <p className="notice">
        The fund recorded an actual return of{" "}
        <strong>{ugx(proposedRoiUgx)}</strong>: payout{" "}
        <strong>{ugx(proposedPayoutUgx)}</strong> · reinvestment{" "}
        <strong>{ugx(proposedReinvestUgx)}</strong>. Confirm these amounts to
        let the admin complete your instruction.
      </p>
      <ActionButton>Confirm updated amounts</ActionButton>
      <StateMessage state={state} />
    </form>
  );
}

export function MaturityReopenForm({
  instructionId,
}: {
  instructionId: string;
}) {
  const [state, action] = useActionState(
    reopenMaturityInstruction,
    initialActionState,
  );
  return (
    <form className="form" action={action}>
      <input type="hidden" name="instructionId" value={instructionId} />
      <label>
        Resolution notes for the partner
        <textarea name="notes" minLength={10} maxLength={1000} required />
        <small className="muted">
          Reopening returns the instruction to requested so the partner can
          revise the target cycle and re-accept its agreement.
        </small>
      </label>
      <ActionButton>Reopen for partner revision</ActionButton>
      <StateMessage state={state} />
    </form>
  );
}

export type StandingTermsOption = {
  id: string;
  version: string;
  title: string;
};

export function StandingTermsAcceptForm({
  agreements,
}: {
  agreements: StandingTermsOption[];
}) {
  const [state, action] = useActionState(
    acceptStandingTerms,
    initialActionState,
  );
  return (
    <form className="form" action={action}>
      <fieldset>
        <legend>Review and select approved standing terms</legend>
        {agreements.map((agreement) => (
          <div key={agreement.id}>
            <label>
              <input
                type="radio"
                name="agreementVersionId"
                value={agreement.id}
                required
              />{" "}
              {agreement.version} · {agreement.title}
            </label>{" "}
            <Link
              href={`/participation-agreements/${agreement.id}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Read these terms (opens in a new tab)
            </Link>
          </div>
        ))}
      </fieldset>
      <p className="muted">
        By accepting, you authorize automatic full reinvestment of unanswered
        maturities only when the destination cycle uses the terms you select.
        Your acceptance evidence is recorded and linked to any covered rollover.
      </p>
      {agreements.length === 0 ? (
        <p className="muted">No approved standing terms are available.</p>
      ) : (
        <ActionButton>Accept standing reinvest terms</ActionButton>
      )}
      <StateMessage state={state} />
    </form>
  );
}

export function StandingTermsRevokeForm() {
  return (
    <form action={revokeStandingTerms}>
      <ActionButton danger>Revoke standing authorization</ActionButton>
    </form>
  );
}
