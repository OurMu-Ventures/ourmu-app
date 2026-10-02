import { describe, expect, it } from "vitest";

import {
  maturityInstructionSchema,
  maturityInstructionValidationMessage,
} from "@/lib/validation";

const validSubmission = {
  investmentId: "f7213635-be92-5ebe-b501-b39276a45bf1",
  choice: "withdraw_all",
  payoutDestinationId: "",
  channel: "mobile_money",
  providerLabel: "MTN",
  accountName: "Joel Ssenjala",
  accountReference: "0700000000",
  destinationConfirmed: "yes",
  targetCycleId: "",
  agreementAccepted: "",
};

function errorMessage(input: Record<string, unknown>) {
  const result = maturityInstructionSchema.safeParse(input);
  if (result.success) throw new Error("Expected invalid maturity submission");
  return maturityInstructionValidationMessage(result.error);
}

describe("maturity instruction validation messages", () => {
  it("identifies incomplete mobile money details without blaming the selected choice", () => {
    expect(
      errorMessage({
        ...validSubmission,
        providerLabel: "",
        accountName: "",
        accountReference: "",
      }),
    ).toBe(
      "Complete or correct these payout details: bank or network, account name, account number or wallet.",
    );
  });

  it("asks for a choice only when the choice is invalid", () => {
    expect(errorMessage({ ...validSubmission, choice: "" })).toBe(
      "Choose one of the three maturity options.",
    );
  });
});
