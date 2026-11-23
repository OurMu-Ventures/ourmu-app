"use client";

import { useActionState, useState } from "react";

import { allocateBankDeposit } from "@/actions/bank-deposits";
import { ActionButton } from "@/components/ActionButton";
import { AmountInput } from "@/components/AmountInput";
import { StateMessage } from "@/components/StateMessage";
import {
  AUTHORIZATION_METHODS,
  PLACEMENT_ROWS,
  ugxCents,
} from "@/lib/bank-deposits";
import { ugx } from "@/lib/format";
import { initialActionState } from "@/lib/validation";

export type DepositReservation = {
  id: string;
  accountId: string;
  accountName: string;
  amount: string;
  requested: string;
};

function centsText(cents: bigint) {
  const negative = cents < 0n;
  const value = negative ? -cents : cents;
  return `${negative ? "−" : ""}${ugx(Number(value / 100n))}${value % 100n ? `.${String(value % 100n).padStart(2, "0")}` : ""}`;
}

export function DepositAllocationForm({
  requestId,
  investorId,
  cycleId,
  agreementHash,
  receivedDate,
  today,
  reservations,
  accounts,
}: {
  requestId: string;
  investorId: string;
  cycleId: string;
  agreementHash: string;
  receivedDate: string;
  today: string;
  reservations: DepositReservation[];
  accounts: { id: string; name: string }[];
}) {
  const [state, action] = useActionState(
    allocateBankDeposit,
    initialActionState,
  );
  const [received, setReceived] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [placements, setPlacements] = useState(
    Array.from({ length: PLACEMENT_ROWS }, () => ({ accountId: "", amount: "" })),
  );
  const lineCents = [
    ...reservations
      .filter((item) => selected.includes(item.id))
      .map((item) => ugxCents(item.amount)),
    ...placements
      .filter((row) => row.amount.trim())
      .map((row) => ugxCents(row.amount)),
  ];
  const invalidLine = lineCents.some((value) => value === null);
  const allocated = lineCents.reduce<bigint>((sum, value) => sum + (value ?? 0n), 0n);
  const receivedCents = ugxCents(received);
  const remaining = receivedCents === null ? null : receivedCents - allocated;
  const hasPlacement = placements.some((row) => row.amount.trim());
  // Controlled fields keep their values when the server rejects a submission.
  const [fields, setFields] = useState<Record<string, string>>({});
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const field = (name: string) => ({
    name,
    value: fields[name] ?? "",
    onChange: (
      event: React.ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >,
    ) => setFields((values) => ({ ...values, [name]: event.target.value })),
  });
  const check = (name: string) => ({
    name,
    type: "checkbox",
    value: "yes",
    checked: checks[name] ?? false,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      setChecks((values) => ({ ...values, [name]: event.target.checked })),
  });
  const updatePlacement = (
    index: number,
    change: Partial<{ accountId: string; amount: string }>,
  ) =>
    setPlacements((rows) =>
      rows.map((row, position) => (position === index ? { ...row, ...change } : row)),
    );
  return (
    <form className="form" action={action}>
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="investorId" value={investorId} />
      <input type="hidden" name="cycleId" value={cycleId} />
      <input type="hidden" name="agreementHash" value={agreementHash} />
      <input type="hidden" name="receivedDate" value={receivedDate} />
      <h3>Bank deposit</h3>
      <label>
        Bank reference
        <input {...field("bankReference")} autoComplete="off" required minLength={3} maxLength={120} />
      </label>
      <label>
        Exact amount received (UGX)
        <AmountInput
          name="receivedAmountUgx"
          value={received}
          onValueChange={setReceived}
          required
        />
      </label>
      <label>
        Statement time (Uganda, optional)
        <input {...field("receivedTime")} type="time" />
        <small className="muted">
          Only if the bank statement shows it. The payment date above decides the cycle.
        </small>
      </label>

      <h3>Split</h3>
      {reservations.length > 0 && (
        <fieldset>
          <legend>Fund pending reservations in full</legend>
          {reservations.map((item) => (
            <label key={item.id}>
              <input
                type="checkbox"
                name="reservation"
                value={item.id}
                checked={selected.includes(item.id)}
                onChange={(event) =>
                  setSelected((ids) =>
                    event.target.checked
                      ? [...ids, item.id]
                      : ids.filter((id) => id !== item.id),
                  )
                }
              />{" "}
              {ugx(Number(item.amount))} · {item.accountName} · reserved {item.requested}
              <input type="hidden" name={`reservationAccount.${item.id}`} value={item.accountId} />
              <input type="hidden" name={`reservationAmount.${item.id}`} value={item.amount} />
            </label>
          ))}
        </fieldset>
      )}
      <fieldset>
        <legend>New placements the partner instructed offline</legend>
        {placements.map((row, index) => (
          <div className="deposit-placement-row" key={index}>
            <label>
              Account {index + 1}
              <select
                name={`placementAccount.${index}`}
                value={row.accountId}
                onChange={(event) => updatePlacement(index, { accountId: event.target.value })}
              >
                <option value="">Not used</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Amount (UGX)
              <AmountInput
                name={`placementAmount.${index}`}
                value={row.amount}
                onValueChange={(amount) => updatePlacement(index, { amount })}
              />
            </label>
          </div>
        ))}
      </fieldset>
      <p className={remaining === 0n && !invalidLine ? "success" : "notice"} aria-live="polite">
        Allocated {centsText(allocated)}
        {remaining === null
          ? " · enter the amount received"
          : remaining === 0n
            ? " · matches the deposit"
            : ` · ${centsText(remaining)} ${remaining > 0n ? "still to allocate" : "over the deposit"}`}
        {invalidLine ? " · check the line amounts" : ""}
      </p>

      <h3>Partner’s split instructions</h3>
      <label>
        Date the partner gave the instructions (Uganda)
        <input {...field("authorizedOn")} type="date" max={today} required />
      </label>
      <label>
        How the partner instructed it
        <select {...field("authorizationMethod")} required>
          <option value="" disabled>
            Choose a method
          </option>
          {AUTHORIZATION_METHODS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Evidence reference
        <input
          {...field("evidenceReference")}
          required
          minLength={5}
          maxLength={500}
          placeholder="Where the retained instruction is kept, e.g. mailbox and message date"
        />
      </label>
      <label>
        Verification notes
        <textarea
          {...field("verificationNotes")}
          required
          minLength={10}
          maxLength={2000}
          placeholder="How the statement line, the partner’s identity and the split were checked"
        />
      </label>
      <label>
        <input {...check("identityVerified")} required /> I
        verified the partner’s identity and that the instruction came from them.
      </label>
      <label>
        <input {...check("splitVerified")} required /> I
        matched this deposit on the bank statement and the split to the
        partner’s instructions.
      </label>
      {hasPlacement && (
        <label>
          <input {...check("agreementAccepted")} required />{" "}
          The retained instructions show the partner accepted the cycle
          agreement shown above for each new placement. No electronic acceptance
          is recorded.
        </label>
      )}
      <label>
        Type ALLOCATE
        <input {...field("confirmation")} autoComplete="off" required pattern="ALLOCATE" />
      </label>
      <ActionButton>Allocate deposit</ActionButton>
      <StateMessage state={state} />
    </form>
  );
}
