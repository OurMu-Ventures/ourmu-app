"use client";

import { useActionState } from "react";
import {
  recordOfflineReinvestment,
  completeOfflineReinvestment,
  revokeOfflineReinvestment,
} from "@/actions/offline-reinvestment";
import { ActionButton } from "@/components/ActionButton";
import { StateMessage } from "@/components/StateMessage";
import { initialActionState } from "@/lib/validation";

export function OfflineAuthorizationForm({
  investmentId,
  cycleId,
  agreementHash,
  amount,
  targetMaturityDate,
  targetReturnBps,
}: {
  investmentId: string;
  cycleId: string;
  agreementHash: string;
  amount: string;
  targetMaturityDate: string;
  targetReturnBps: number;
}) {
  const [state, action] = useActionState(
    recordOfflineReinvestment,
    initialActionState,
  );
  return (
    <form action={action} className="form">
      <input type="hidden" name="investmentId" value={investmentId} />
      <input type="hidden" name="cycleId" value={cycleId} />
      <input type="hidden" name="agreementHash" value={agreementHash} />
      <input type="hidden" name="amount" value={amount} />
      <input
        type="hidden"
        name="targetMaturityDate"
        value={targetMaturityDate}
      />
      <input type="hidden" name="targetReturnBps" value={targetReturnBps} />
      <label>
        Partner authorization date (Uganda)
        <input name="authorizedOn" type="date" required />
      </label>
      <label>
        Authorization method
        <select name="method" required>
          <option value="signed_document">Signed document</option>
          <option value="recorded_call">Recorded call</option>
          <option value="in_person">In person</option>
        </select>
      </label>
      <label>
        Evidence reference
        <input
          name="evidenceReference"
          required
          minLength={5}
          maxLength={500}
          placeholder="Document reference or location of the retained evidence"
        />
      </label>
      <label>
        Verification notes
        <textarea
          name="verificationNotes"
          required
          minLength={10}
          maxLength={2000}
          placeholder="How identity, authorization, and prior settlement were checked"
        />
      </label>
      <label>
        <input type="checkbox" name="identityVerified" value="yes" required /> I
        independently verified the partner’s identity.
      </label>
      <label>
        <input type="checkbox" name="settlementChecked" value="yes" required />{" "}
        I checked external records and this amount has not already been paid or
        reinvested.
      </label>
      <label>
        <input type="checkbox" name="agreementAccepted" value="yes" required />{" "}
        The retained evidence authorizes the full amount shown and acceptance of
        the destination agreement displayed above.
      </label>
      <ActionButton>Record offline authorization</ActionButton>
      <StateMessage state={state} />
    </form>
  );
}

export function OfflineCompletionForm({
  authorizationId,
}: {
  authorizationId: string;
}) {
  const [state, action] = useActionState(
    completeOfflineReinvestment,
    initialActionState,
  );
  return (
    <details className="notice">
      <summary>Review completion</summary>
      <p>
        Completion transfers the full authorized matured value into an active
        investment and issues a receipt. Verify the partner, amount, evidence,
        and cycle shown above.
      </p>
      <form action={action} className="form">
        <input type="hidden" name="authorizationId" value={authorizationId} />
        <label>
          Type REINVEST to complete
          <input
            name="confirmation"
            required
            pattern="REINVEST"
            autoComplete="off"
          />
        </label>
        <ActionButton>Confirm reinvestment</ActionButton>
        <StateMessage state={state} />
      </form>
    </details>
  );
}

export function OfflineRevocationForm({
  authorizationId,
}: {
  authorizationId: string;
}) {
  const [state, action] = useActionState(
    revokeOfflineReinvestment,
    initialActionState,
  );
  return (
    <details className="notice">
      <summary>Revoke authorization before completion</summary>
      <form action={action} className="form">
        <input type="hidden" name="authorizationId" value={authorizationId} />
        <label>
          Reason
          <textarea name="reason" required minLength={10} maxLength={2000} />
        </label>
        <ActionButton>Revoke authorization</ActionButton>
        <StateMessage state={state} />
      </form>
    </details>
  );
}
