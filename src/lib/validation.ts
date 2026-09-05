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
  units: z.coerce.number().int().min(1).max(500),
  agreementAccepted: z.literal("yes"),
});
export const activationSchema = z.object({
  investmentId: z.uuid(),
  bankReference: z.string().trim().min(3).max(120),
  receivedAmountUgx: z.coerce.number().int().positive().safe(),
  receivedDate: z.iso.date(),
  confirmation: z.literal("ACTIVATE"),
});

export type ActionState = {
  ok: boolean;
  message: string;
  fieldErrors?: Record<string, string[]>;
};
export const initialActionState: ActionState = { ok: false, message: "" };
