import { z } from "zod";

const phone = z.string().trim().min(7).max(30);
export const emailSchema = z
  .string()
  .trim()
  .transform((value) => value.toLowerCase())
  .pipe(z.email());

export const applicationSchema = z.object({
  legalName: z.string().trim().min(3).max(120),
  email: emailSchema,
  phone,
  dateOfBirth: z.iso.date(),
  nin: z.string().trim().min(8).max(32),
  address: z.string().trim().min(5).max(300),
  district: z.string().trim().min(2).max(100),
  country: z.string().trim().min(2).max(100),
  consent: z.literal("yes"),
});

export const invitationSchema = z.object({ email: emailSchema });
export const nextOfKinSchema = z.object({
  legalName: z.string().trim().min(3).max(120),
  relationship: z.string().trim().min(2).max(80),
  phone,
  email: z.union([emailSchema, z.literal("")]),
  address: z.string().trim().min(5).max(300),
});
export const investmentRequestSchema = z.object({
  cycleId: z.uuid(),
  principalUgx: z
    .string()
    .trim()
    .regex(/^\d+(?:\.\d{1,2})?$/)
    .refine((value) => Number(value) >= 125_000 && Number(value) <= 62_500_000),
  agreementAccepted: z.literal("yes"),
});
export const activationSchema = z.object({
  investmentId: z.uuid(),
  bankReference: z.string().trim().min(3).max(120),
  receivedAmountUgx: z
    .string()
    .trim()
    .regex(/^\d+(?:\.\d{1,8})?$/)
    .refine((value) => Number(value) > 0),
  receivedDate: z.iso.date(),
  confirmation: z.literal("ACTIVATE"),
});

export const maturityChoiceSchema = z.enum([
  "withdraw_all",
  "withdraw_roi_reinvest_principal",
  "reinvest_all",
]);

export const payoutChannelSchema = z.enum(["bank", "mobile_money"]);

// A payout destination is saved for future use. The account reference is
// encrypted at the application layer; only the last four are displayable.
export const payoutDestinationSchema = z.object({
  channel: payoutChannelSchema,
  providerLabel: z.string().trim().min(2).max(80),
  accountName: z.string().trim().min(3).max(120),
  accountReference: z.string().trim().min(3).max(64),
});

export const maturityInstructionSchema = z.object({
  investmentId: z.uuid(),
  choice: maturityChoiceSchema,
  // Present when the choice involves a payout: either a saved destination
  // or a new one plus an explicit confirmation on submission.
  payoutDestinationId: z.union([z.uuid(), z.literal("")]).optional(),
  ...payoutDestinationSchema.partial().shape,
  destinationConfirmed: z.union([z.literal("yes"), z.literal("")]).optional(),
  // Present when the choice involves reinvestment: the destination cycle
  // plus acceptance of that cycle's current agreement.
  targetCycleId: z.union([z.uuid(), z.literal("")]).optional(),
  agreementAccepted: z.union([z.literal("yes"), z.literal("")]).optional(),
});

export const maturityFulfillmentSchema = z.object({
  instructionId: z.uuid(),
  actualRoiUgx: z
    .string()
    .trim()
    .regex(/^\d+(?:\.\d{1,2})?$/)
    .refine((value) => Number(value) >= 0),
  payoutReference: z.string().trim().max(120).optional(),
  destinationVerified: z.union([z.literal("yes"), z.literal("")]).optional(),
  confirmation: z.literal("FULFILL"),
});

export const maturityConfirmSchema = z.object({ instructionId: z.uuid() });

export const maturityReopenSchema = z.object({
  instructionId: z.uuid(),
  notes: z.string().trim().min(10).max(1000),
});

export const standingTermsSchema = z.object({
  agreementVersionId: z.uuid(),
});

export type ActionState = {
  ok: boolean;
  message: string;
  fieldErrors?: Record<string, string[]>;
  sensitiveAction?: {
    url: string;
    label: string;
  };
};
export const initialActionState: ActionState = { ok: false, message: "" };
