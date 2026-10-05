"use client";

import { useActionState, useState } from "react";
import { saveAdminPayoutDestination } from "@/actions/admin-payout";
import { ActionButton } from "@/components/ActionButton";
import { StateMessage } from "@/components/StateMessage";
import { initialActionState } from "@/lib/validation";

export function AdminPayoutDestinationForm({
  instructionId,
}: {
  instructionId: string;
}) {
  const [state, action] = useActionState(
    saveAdminPayoutDestination,
    initialActionState,
  );
  const [channel, setChannel] = useState("mobile_money");
  const [referenceSource, setReferenceSource] = useState("profile_phone");
  return (
    <details className="notice">
      <summary>Set up a verified payout destination</summary>
      <p>
        Record details confirmed offline with the partner. This saves the
        destination; it does not send money or activate a reinvestment.
      </p>
      <form action={action} className="form-grid">
        <input type="hidden" name="instructionId" value={instructionId} />
        <label>
          Payment channel
          <select
            name="channel"
            value={channel}
            onChange={(event) => {
              setChannel(event.target.value);
              if (event.target.value === "bank") setReferenceSource("manual");
            }}
          >
            <option value="mobile_money">Mobile money</option>
            <option value="bank">Bank</option>
          </select>
        </label>
        <label>
          Provider or bank
          <input
            name="providerLabel"
            required
            minLength={2}
            maxLength={80}
            placeholder="For example, MTN"
          />
        </label>
        <label>
          Account holder
          <input name="accountName" required minLength={3} maxLength={120} />
        </label>
        <label>
          Account reference
          <select
            name="referenceSource"
            value={referenceSource}
            onChange={(event) => setReferenceSource(event.target.value)}
          >
            {channel === "mobile_money" && (
              <option value="profile_phone">
                Use the partner’s phone on file
              </option>
            )}
            <option value="manual">Enter the verified account reference</option>
          </select>
        </label>
        {referenceSource === "manual" ? (
          <label>
            Account number or phone
            <input
              name="accountReference"
              required
              minLength={3}
              maxLength={64}
              autoComplete="off"
            />
          </label>
        ) : (
          <input type="hidden" name="accountReference" value="" />
        )}
        <label>
          Verified with the partner by
          <select name="verificationMethod">
            <option value="phone">Phone</option>
            <option value="email">Email</option>
            <option value="in_person">In person</option>
          </select>
        </label>
        <label>
          <input type="checkbox" name="offlineVerified" value="yes" required />{" "}
          I verified the provider, account holder, and account reference offline
          with the partner.
        </label>
        <ActionButton>Save verified destination</ActionButton>
        <StateMessage state={state} />
      </form>
    </details>
  );
}
