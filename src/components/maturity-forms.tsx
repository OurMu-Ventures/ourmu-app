"use client";

import { DEFAULT_INVESTMENT_LIMIT_UGX } from "@/lib/investment-limits";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { CheckCircle2, ExternalLink } from "lucide-react";
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
import { formatBpsPercent } from "@/lib/actual-returns";
import { ugx } from "@/lib/format";
import {
  MATURITY_CHOICES,
  PAKA_PAKA_EXPLANATION,
  customWithdrawalError,
  maturitySplits,
  safeFulfilledSplits,
  UNAVAILABLE_MATURITY_AMOUNTS,
  type CustomMaturityBasis,
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
  maturity_date?: string;
};

export type AssignedCycleOption = {
  id: string;
  name: string;
  maturity_date: string;
  agreement_version_id: string;
  agreement_title: string;
};

export function MaturityInstructionForm({
  limitUgx = DEFAULT_INVESTMENT_LIMIT_UGX,
  investmentId,
  principalUgx,
  returnUgx,
  returnBasis,
  actualReturnBps = null,
  savedDestinations,
  openCycles,
  assignedCycle,
  existingChoice,
  existingWithdrawalUgx,
  isRevision,
}: {
  limitUgx?: number;
  investmentId: string;
  principalUgx: number;
  // The recorded cycle return when it exists, otherwise the projection.
  returnUgx: number;
  returnBasis: "actual" | "projected";
  // The recorded cycle rate behind returnUgx; sent back so the server
  // rejects the choice if the displayed basis is stale.
  actualReturnBps?: number | null;
  savedDestinations: SavedDestination[];
  openCycles?: OpenCycleOption[];
  assignedCycle?: AssignedCycleOption | null;
  existingChoice?: MaturityChoice;
  existingWithdrawalUgx?: number | null;
  isRevision: boolean;
}) {
  const [state, action] = useActionState(
    submitMaturityInstruction,
    initialActionState,
  );
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const element = form.current;
    const preserveValues = (event: Event) => event.preventDefault();
    element?.addEventListener("reset", preserveValues);
    return () => element?.removeEventListener("reset", preserveValues);
  }, []);
  const confirmation = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.ok && state.message) {
      confirmation.current?.focus({ preventScroll: true });
      confirmation.current?.scrollIntoView?.({
        block: "center",
        behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")
          .matches
          ? "auto"
          : "smooth",
      });
    }
  }, [state]);
  const [choice, setChoice] = useState<MaturityChoice | "">(
    existingChoice ?? "",
  );
  const [withdrawal, setWithdrawal] = useState(
    existingWithdrawalUgx == null ? "" : String(existingWithdrawalUgx),
  );
  const basisLabel = returnBasis === "actual" ? "Actual" : "Projected";
  const total = principalUgx + returnUgx;
  const withdrawalError = [principalUgx, returnUgx].some(
    (amount) => !Number.isFinite(amount) || amount < 0,
  )
    ? "This investment total is unavailable. Please reload."
    : customWithdrawalError(withdrawal, total, limitUgx);
  const withdrawalInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    withdrawalInput.current?.setCustomValidity(withdrawalError ?? "");
  }, [choice, withdrawalError]);
  const customSplit = withdrawalError
    ? null
    : maturitySplits(
        principalUgx,
        returnUgx,
        "withdraw_roi_reinvest_principal",
        Number(withdrawal),
      );
  const [useSaved, setUseSaved] = useState(savedDestinations.length > 0);
  const legacyCycles = openCycles ?? [];
  const resolvedCycle: AssignedCycleOption | null =
    assignedCycle ??
    (legacyCycles.length === 1
      ? {
          id: legacyCycles[0].id,
          name: legacyCycles[0].name,
          maturity_date: legacyCycles[0].maturity_date ?? "",
          agreement_version_id: legacyCycles[0].agreement_version_id,
          agreement_title: legacyCycles[0].agreement_title,
        }
      : null);
  const agreementAcceptance = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (agreementAcceptance.current)
      agreementAcceptance.current.checked = false;
  }, [resolvedCycle?.id, resolvedCycle?.agreement_version_id]);
  const reinvestAvailable = Boolean(resolvedCycle);
  const needsPayout =
    choice === "withdraw_all" || choice === "withdraw_roi_reinvest_principal";
  const needsReinvest =
    choice === "withdraw_roi_reinvest_principal" || choice === "reinvest_all";

  return (
    <form className="form" action={action} ref={form}>
      {state.ok && state.message && (
        <div
          className="success"
          role="region"
          aria-label="Maturity choice saved"
          tabIndex={-1}
          ref={confirmation}
        >
          <h3>
            <CheckCircle2 aria-hidden="true" size={22} /> Your maturity choice
            is saved
          </h3>
          <p>{state.message}</p>
        </div>
      )}
      <input type="hidden" name="investmentId" value={investmentId} />
      <input type="hidden" name="expectedReturnBasis" value={returnBasis} />
      <input
        type="hidden"
        name="expectedActualReturnBps"
        value={returnBasis === "actual" ? (actualReturnBps ?? "") : ""}
      />
      <fieldset>
        <legend>Your maturity choice</legend>
        {MATURITY_CHOICES.map((option) => {
          const splits = maturitySplits(principalUgx, returnUgx, option.value);
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
                  {option.value === "withdraw_roi_reinvest_principal" ? (
                    "Enter your withdrawal amount below to see the split."
                  ) : (
                    <>
                      {basisLabel} payout {ugx(splits.payoutUgx)} ·{" "}
                      {basisLabel.toLowerCase()} reinvestment{" "}
                      {ugx(splits.reinvestUgx)}
                    </>
                  )}
                </small>
              </span>
            </label>
          );
        })}
      </fieldset>

      {choice === "withdraw_roi_reinvest_principal" && (
        <fieldset>
          <legend>Your withdrawal amount</legend>
          <p>
            Available {basisLabel.toLowerCase()} total:{" "}
            <strong>{ugx(total)}</strong>
          </p>
          {existingChoice === "withdraw_roi_reinvest_principal" &&
            existingWithdrawalUgx == null && (
              <p className="notice">
                Your recorded instruction withdraws ROI and reinvests principal.
                Enter an amount and submit to replace those original terms.
              </p>
            )}
          <label>
            Amount to withdraw (UGX)
            <input
              name="requestedWithdrawalUgx"
              type="text"
              inputMode="decimal"
              ref={withdrawalInput}
              value={withdrawal}
              onChange={(event) => setWithdrawal(event.target.value)}
              required
              aria-describedby="withdrawal-help withdrawal-preview"
              aria-invalid={withdrawal !== "" && !!withdrawalError}
            />
          </label>
          <p id="withdrawal-preview" aria-live="polite">
            {customSplit ? (
              <>
                {basisLabel} payout {ugx(customSplit.payoutUgx)} ·{" "}
                {basisLabel.toLowerCase()} reinvestment{" "}
                {ugx(customSplit.reinvestUgx)}
              </>
            ) : (
              withdrawalError
            )}
          </p>
          <p id="withdrawal-help" className="muted">
            {returnBasis === "actual"
              ? "These amounts use the cycle's recorded actual return."
              : PAKA_PAKA_EXPLANATION}
          </p>
        </fieldset>
      )}

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

      {needsReinvest &&
        (reinvestAvailable && resolvedCycle ? (
          <fieldset>
            <legend>Reinvestment destination</legend>
            <input
              type="hidden"
              name="targetCycleId"
              value={resolvedCycle.id}
            />
            <input
              type="hidden"
              name="expectedAgreementVersionId"
              value={resolvedCycle.agreement_version_id}
            />
            <p>
              Your reinvestment cycle: <strong>{resolvedCycle.name}</strong>
              {resolvedCycle.maturity_date
                ? ` · matures ${resolvedCycle.maturity_date}`
                : ""}
            </p>
            <p className="muted">
              <small>
                The cycle is assigned automatically when your choice is
                recorded. Saving does not reserve capacity; capacity and your
                cumulative limit are rechecked during processing. If checks
                fail, your instruction is held for staff resolution and never
                moved to another cycle.
              </small>
            </p>
            <label className="checkbox">
              <input
                ref={agreementAcceptance}
                name="agreementAccepted"
                type="checkbox"
                value="yes"
                required
              />
              <span>
                I have read and accept the{" "}
                <Link
                  aria-label={`${resolvedCycle.agreement_title} (opens in a new tab)`}
                  className="agreement-acceptance-link"
                  href={`/participation-agreements/${resolvedCycle.agreement_version_id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span>{resolvedCycle.agreement_title}</span>
                  <ExternalLink
                    aria-hidden="true"
                    size={15}
                    strokeWidth={2.5}
                  />
                </Link>
                . This records a legally significant acceptance receipt.
              </span>
            </label>
          </fieldset>
        ) : (
          <p className="notice">
            Reinvestment is unavailable; no eligible cycle is open. Full
            withdrawal remains available.
          </p>
        ))}

      <ActionButton>
        {isRevision ? "Revise maturity choice" : "Record maturity choice"}
      </ActionButton>
      {!state.ok && <StateMessage state={state} />}
    </form>
  );
}

// Cycle: the recorded cycle rate is authoritative and not editable here; the
// derived amount is submitted only so a stale page is rejected. Legacy: a
// cycle settled before cycle-wide returns keeps the per-investment entry.
export type FulfillmentReturn =
  | { kind: "cycle"; actualRoiUgx: number; actualReturnBps: number }
  | { kind: "legacy" };

export function MaturityFulfillmentForm({
  instructionId,
  partnerName,
  principalUgx,
  choice,
  customBasis,
  targetCycleName,
  actualReturn,
}: {
  instructionId: string;
  partnerName: string;
  principalUgx: number;
  choice: MaturityChoice;
  customBasis?: CustomMaturityBasis;
  targetCycleName?: string;
  actualReturn: FulfillmentReturn;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const reviewButton = useRef<HTMLButtonElement>(null);
  const restoreReviewFocus = useRef(false);
  const titleId = useId();
  const descriptionId = useId();
  const [legacyRoi, setLegacyRoi] = useState("");
  const [preview, setPreview] = useState<{
    roi: string;
    payoutUgx: number;
    reinvestUgx: number;
    payoutReference: string;
    destinationVerified: string;
  } | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [state, action, pending] = useActionState(
    async (previous: typeof initialActionState, formData: FormData) => {
      const result = await fulfillMaturityInstruction(previous, formData);
      dialog.current?.close();
      setPreview(null);
      return result;
    },
    initialActionState,
  );
  const roi =
    actualReturn.kind === "cycle"
      ? String(actualReturn.actualRoiUgx)
      : legacyRoi;
  const split =
    roi.trim() === ""
      ? null
      : safeFulfilledSplits(principalUgx, Number(roi), choice, customBasis);
  const needsPayout = split ? split.payoutUgx > 0 : choice !== "reinvest_all";

  useEffect(() => {
    if (preview && dialog.current && !dialog.current.open) {
      restoreReviewFocus.current = true;
      dialog.current.showModal();
      dialog.current.querySelector<HTMLButtonElement>("button")?.focus();
    } else if (!preview && !pending && restoreReviewFocus.current) {
      reviewButton.current?.focus();
      restoreReviewFocus.current = false;
    }
  }, [preview, pending]);

  function cancelReview() {
    if (pending) return;
    dialog.current?.close();
    setPreview(null);
  }

  return (
    <>
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!event.currentTarget.reportValidity()) return;
          if (!split) {
            setPreviewError(UNAVAILABLE_MATURITY_AMOUNTS);
            return;
          }
          const data = new FormData(event.currentTarget);
          if (
            needsPayout &&
            !String(data.get("payoutReference") ?? "").trim()
          ) {
            setPreviewError(
              "Enter the external payout reference before reviewing completion.",
            );
            return;
          }
          setPreviewError("");
          setPreview({
            roi,
            ...split,
            payoutReference: String(data.get("payoutReference") ?? "").trim(),
            destinationVerified: String(data.get("destinationVerified") ?? ""),
          });
        }}
      >
        <input type="hidden" name="instructionId" value={instructionId} />
        <div className="form-grid">
          {actualReturn.kind === "cycle" ? (
            <p>
              <input
                type="hidden"
                name="actualRoiUgx"
                value={actualReturn.actualRoiUgx}
              />
              Actual ROI <strong>{ugx(actualReturn.actualRoiUgx)}</strong>
              <br />
              <small className="muted">
                From the cycle&apos;s recorded actual return of{" "}
                {formatBpsPercent(actualReturn.actualReturnBps)}. It cannot be
                edited per investment.
              </small>
            </p>
          ) : (
            <label>
              Actual ROI (UGX)
              <input
                name="actualRoiUgx"
                type="number"
                min="0"
                step="0.01"
                required
                value={legacyRoi}
                onChange={(event) => setLegacyRoi(event.target.value)}
              />
              <small className="muted">
                Legacy per-investment settlement: this cycle started settling
                before cycle-wide returns. If the amount differs from the
                projection, the partner must confirm the new amounts before
                anything moves.
              </small>
            </label>
          )}
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
              I have opened the revealed payout destination below and verified
              it matches the external transfer.
            </span>
          </label>
        )}
        <button
          ref={reviewButton}
          type="submit"
          className="button"
          disabled={pending}
        >
          Review completion
        </button>
        {previewError && (
          <p role="alert" className="notice">
            {previewError}
          </p>
        )}
      </form>
      {preview && (
        <dialog
          ref={dialog}
          className="maturity-confirmation-dialog"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          onKeyDown={(event) => {
            if (event.key !== "Tab") return;
            const buttons =
              event.currentTarget.querySelectorAll<HTMLButtonElement>(
                "button:not(:disabled)",
              );
            const first = buttons[0];
            const last = buttons[buttons.length - 1];
            if (!first) event.preventDefault();
            else if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }}
          onCancel={(event) => {
            event.preventDefault();
            cancelReview();
          }}
        >
          <form className="form" action={action}>
            <h2 id={titleId}>Confirm instruction completion</h2>
            <p id={descriptionId}>
              Review the amounts for <strong>{partnerName}</strong> before
              completing this instruction. This records completion; it does not
              send money.
            </p>
            <dl className="maturity-confirmation-amounts">
              <div>
                <dt>Partner</dt>
                <dd>{partnerName}</dd>
              </div>
              <div>
                <dt>Payout</dt>
                <dd>{ugx(preview.payoutUgx)}</dd>
              </div>
              <div>
                <dt>Reinvestment</dt>
                <dd>{ugx(preview.reinvestUgx)}</dd>
              </div>
              {preview.reinvestUgx > 0 && (
                <div>
                  <dt>Reinvestment cycle</dt>
                  <dd>{targetCycleName ?? "Unavailable"}</dd>
                </div>
              )}
              {preview.payoutUgx > 0 && (
                <div>
                  <dt>External payout reference</dt>
                  <dd>{preview.payoutReference}</dd>
                </div>
              )}
            </dl>
            <p className="muted">
              If revised amounts need partner confirmation or an instruction
              needs resolution, completion will wait until those checks are
              satisfied.
            </p>
            <input type="hidden" name="instructionId" value={instructionId} />
            <input type="hidden" name="actualRoiUgx" value={preview.roi} />
            <input
              type="hidden"
              name="payoutReference"
              value={preview.payoutReference}
            />
            <input
              type="hidden"
              name="destinationVerified"
              value={preview.destinationVerified}
            />
            <input type="hidden" name="confirmation" value="yes" />
            <div className="maturity-confirmation-actions">
              <button
                type="button"
                className="button-secondary"
                disabled={pending}
                onClick={cancelReview}
              >
                Cancel
              </button>
              <ActionButton>Confirm completion</ActionButton>
            </div>
          </form>
        </dialog>
      )}
      <StateMessage state={state} />
    </>
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
