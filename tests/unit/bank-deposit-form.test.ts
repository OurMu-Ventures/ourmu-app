import { describe, expect, it } from "vitest";

import { parseDepositAllocationForm, ugxCents } from "@/lib/bank-deposits";

const ids = {
  request: "6d1c4f63-6c7a-4b8e-9f1e-0d4f2c3b1a01",
  partner: "6d1c4f63-6c7a-4b8e-9f1e-0d4f2c3b1a02",
  cycle: "6d1c4f63-6c7a-4b8e-9f1e-0d4f2c3b1a03",
  main: "6d1c4f63-6c7a-4b8e-9f1e-0d4f2c3b1a04",
  school: "6d1c4f63-6c7a-4b8e-9f1e-0d4f2c3b1a05",
  retirement: "6d1c4f63-6c7a-4b8e-9f1e-0d4f2c3b1a06",
  reservation: "6d1c4f63-6c7a-4b8e-9f1e-0d4f2c3b1a07",
};

// Synthetic 3m UGX deposit split 2m / 500k / 500k across three accounts.
function form(overrides: Record<string, string | null> = {}) {
  const data = new FormData();
  const values: Record<string, string | null> = {
    requestId: ids.request,
    investorId: ids.partner,
    cycleId: ids.cycle,
    agreementHash: "ab".repeat(32),
    bankReference: " DEP-SYNTH-1 ",
    receivedAmountUgx: "3,000,000",
    receivedDate: "2026-11-20",
    receivedTime: "",
    authorizedOn: "2026-11-20",
    authorizationMethod: "email",
    evidenceReference: "Mailbox: split instruction email",
    verificationNotes: "Matched statement line and partner instruction email.",
    identityVerified: "yes",
    splitVerified: "yes",
    agreementAccepted: "yes",
    confirmation: "ALLOCATE",
    "placementAccount.0": ids.main,
    "placementAmount.0": "2,000,000",
    "placementAccount.1": ids.school,
    "placementAmount.1": "500000",
    "placementAccount.2": ids.retirement,
    "placementAmount.2": "500000.00",
    ...overrides,
  };
  for (const [name, value] of Object.entries(values))
    if (value !== null) data.set(name, value);
  return data;
}

describe("deposit allocation form", () => {
  it("parses the synthetic 3m split into three offline placements", () => {
    const result = parseDepositAllocationForm(form());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input.bankReference).toBe("DEP-SYNTH-1");
    expect(result.input.receivedAmountUgx).toBe("3000000");
    expect(result.input.receivedAt).toBeNull();
    expect(result.input.allocations).toEqual([
      { kind: "offline_placement", account_id: ids.main, amount_ugx: "2000000" },
      { kind: "offline_placement", account_id: ids.school, amount_ugx: "500000" },
      { kind: "offline_placement", account_id: ids.retirement, amount_ugx: "500000.00" },
    ]);
  });

  it("keeps a reservation's reviewed account and principal", () => {
    const data = form({ "placementAccount.0": null, "placementAmount.0": null });
    data.append("reservation", ids.reservation);
    data.set(`reservationAccount.${ids.reservation}`, ids.main);
    data.set(`reservationAmount.${ids.reservation}`, "2000000.00");
    const result = parseDepositAllocationForm(data);
    expect(result.ok && result.input.allocations[0]).toEqual({
      kind: "reservation",
      investment_id: ids.reservation,
      account_id: ids.main,
      amount_ugx: "2000000.00",
    });
  });

  it("converts an optional statement time from Uganda time", () => {
    const result = parseDepositAllocationForm(form({ receivedTime: "14:05" }));
    expect(result.ok && result.input.receivedAt).toBe("2026-11-20T11:05:00.000Z");
  });

  it("requires offline agreement acceptance when creating placements", () => {
    const result = parseDepositAllocationForm(form({ agreementAccepted: null }));
    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.message).toContain("accepted the cycle agreement");
  });

  it.each([
    ["missing identity check", { identityVerified: null }],
    ["wrong confirmation", { confirmation: "allocate" }],
    ["three decimals", { receivedAmountUgx: "3000000.001" }],
    ["short evidence", { evidenceReference: "x" }],
  ])("rejects %s", (_, overrides) => {
    expect(parseDepositAllocationForm(form(overrides)).ok).toBe(false);
  });

  it("rejects half-filled placement rows and empty splits", () => {
    expect(parseDepositAllocationForm(form({ "placementAccount.1": "" })).ok).toBe(false);
    const empty = form({
      "placementAccount.0": null, "placementAmount.0": null,
      "placementAccount.1": null, "placementAmount.1": null,
      "placementAccount.2": null, "placementAmount.2": null,
    });
    expect(parseDepositAllocationForm(empty).ok).toBe(false);
  });

  it("totals amounts exactly in cents", () => {
    expect(ugxCents("2,000,000")).toBe(200000000n);
    expect(ugxCents("500000.5")).toBe(50000050n);
    expect(ugxCents("1.234")).toBeNull();
  });
});
