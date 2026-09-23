"use client";

import { useActionState, useState } from "react";
import Link from "next/link";

import {
  fulfillMaturityInstruction,
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
    choice === "withdraw_all" ||
    choice === "withdraw_roi_reinvest_principal";
  const needsReinvest =
    choice === "withdraw_roi_reinvest_principal" || choice === "reinvest_all";
  const selectedCycle = openCycles.find(
    (cycle) => cycle.id === targetCycleId,
  );

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
              Saved for future use. Only you and authorized admins can see
              these details.
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
          {selectedCycle && (
            <p className="muted">
              <Link
                href={`/participation-agreements/${selectedCycle.agreement_version_id}`}
                target="_blank"
                rel="noreferrer"
              >
                Read {selectedCycle.agreement_title} (opens in a new tab)
              </Link>
            </p>
          )}
          <label className="checkbox">
            <input
              name="agreementAccepted"
              type="checkbox"
              value="yes"
              required
            />
            <span>
              I have read and accept the destination cycle&apos;s current
              agreement. This records a legally significant acceptance.
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
            never proof of cash.
          </small>
        </label>
        {needsPayout && (
          <label>
            External payout reference
            <input name="payoutReference" autoComplete="off" required />
          </label>
        )}
      </div>
      <label>
        Type FULFILL
        <input name="confirmation" autoComplete="off" required />
      </label>
      <ActionButton>Fulfill instruction</ActionButton>
      <StateMessage state={state} />
    </form>
  );
}
