import { z } from "zod";

export const offlineReinvestmentSchema = z.object({
  investmentId: z.uuid(),
  cycleId: z.uuid(),
  agreementHash: z.string().regex(/^[a-f0-9]{64}$/i),
  targetMaturityDate: z.iso.date(),
  targetReturnBps: z.coerce.number().int().min(0).max(100000),
  amount: z.string().regex(/^\d+(?:\.\d{1,2})?$/),
  authorizedOn: z.iso.date(),
  method: z.enum(["signed_document", "recorded_call", "in_person"]),
  evidenceReference: z.string().trim().min(5).max(500),
  verificationNotes: z.string().trim().min(10).max(2000),
  identityVerified: z.literal("yes"),
  settlementChecked: z.literal("yes"),
  agreementAccepted: z.literal("yes"),
});

export const offlineCompletionSchema = z.object({
  authorizationId: z.uuid(),
  confirmation: z.literal("REINVEST"),
});
