"use client";

import { useActionState, useState } from "react";

import {
  previewCycleActualReturn,
  recordCycleActualReturn,
  type CycleReturnState,
} from "@/actions/cycle-returns";
import { ActionButton } from "@/components/ActionButton";
import { StateMessage } from "@/components/StateMessage";
import { formatBpsPercent, parsePercentToBps } from "@/lib/actual-returns";
import { ugx } from "@/lib/format";

const initialState: CycleReturnState = { ok: false, message: "" };

function signedUgx(value: number) {
  return value > 0 ? `+${ugx(value)}` : value < 0 ? `−${ugx(-value)}` : ugx(0);
}

export function CycleActualReturnForm({
  cycleId,
  currentBps,
}: {
  cycleId: string;
  currentBps: number | null;
}) {
  const [previewState, previewAction] = useActionState(
    previewCycleActualReturn,
    initialState,
  );
  const [recordState, recordAction] = useActionState(
    recordCycleActualReturn,
    initialState,
  );
  const [percent, setPercent] = useState(
    currentBps == null ? "" : String(currentBps / 100),
  );
  const preview = previewState.ok ? previewState.preview : undefined;
  // Editing the rate after previewing invalidates the confirmation, and a
  // saved preview cannot be submitted twice.
  const showConfirm =
    preview &&
    parsePercentToBps(percent) === preview.actualReturnBps &&
    recordState.savedRequestId !== preview.requestId;

  return (
    <div className="form">
      <form className="form-grid" action={previewAction}>
        <input type="hidden" name="cycleId" value={cycleId} />
        <label>
          Actual return (%)
          <input
            name="actualReturnPercent"
            inputMode="decimal"
            autoComplete="off"
            pattern="\d{1,4}(\.\d{1,2})?"
            required
            value={percent}
            onChange={(event) => setPercent(event.target.value)}
            aria-describedby={`actual-return-help-${cycleId}`}
          />
          <small className="muted" id={`actual-return-help-${cycleId}`}>
            Zero or more, up to two decimal places. Losses are not supported.
          </small>
        </label>
        <ActionButton>Preview affected totals</ActionButton>
      </form>
      {!previewState.ok && <StateMessage state={previewState} />}
      {showConfirm && (
        <form className="form notice" action={recordAction}>
          <p>
            <strong>{formatBpsPercent(preview.actualReturnBps)}</strong>{" "}
            {preview.previousActualReturnBps == null
              ? "will be recorded"
              : `replaces ${formatBpsPercent(preview.previousActualReturnBps)}`}{" "}
            for {preview.investmentCount} funded investment
            {preview.investmentCount === 1 ? "" : "s"}
            {preview.lateEntry
              ? ". This is the one permitted entry after maturity; it cannot be revised afterwards."
              : ". Partners see it immediately and it stays revisable until maturity."}
          </p>
          <dl className="actual-return-preview">
            <div>
              <dt>Total principal</dt>
              <dd>{ugx(preview.principalUgx)}</dd>
            </div>
            <div>
              <dt>Actual profit</dt>
              <dd>{ugx(preview.actualProfitUgx)}</dd>
            </div>
            <div>
              <dt>Total value</dt>
              <dd>{ugx(preview.totalValueUgx)}</dd>
            </div>
            <div>
              <dt>Difference from projection</dt>
              <dd>{signedUgx(preview.differenceUgx)}</dd>
            </div>
          </dl>
          {preview.testInvestmentCount > 0 && (
            <p className="muted">
              {preview.testInvestmentCount} test placement
              {preview.testInvestmentCount === 1 ? "" : "s"} also receive this
              rate and are excluded from these totals.
            </p>
          )}
          <input type="hidden" name="cycleId" value={preview.cycleId} />
          <input
            type="hidden"
            name="actualReturnBps"
            value={preview.actualReturnBps}
          />
          <input
            type="hidden"
            name="expectedRevision"
            value={preview.revision}
          />
          <input
            type="hidden"
            name="expectedInvestmentCount"
            value={preview.investmentCount}
          />
          <input
            type="hidden"
            name="expectedPrincipalUgx"
            value={preview.principalUgx}
          />
          <input type="hidden" name="requestId" value={preview.requestId} />
          <label className="checkbox">
            <input name="confirmed" type="checkbox" value="yes" required />
            <span>
              I confirm this actual return and the affected totals above.
              Recording it does not mature investments or trigger payments.
            </span>
          </label>
          <ActionButton>Save actual return</ActionButton>
        </form>
      )}
      <StateMessage state={recordState} />
    </div>
  );
}
