"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { parsePercentToBps } from "@/lib/actual-returns";
import { requireAdmin } from "@/lib/auth";
import { publicError, requestId } from "@/lib/db";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/validation";

export type CycleReturnPreview = {
  cycleId: string;
  actualReturnBps: number;
  previousActualReturnBps: number | null;
  revision: number;
  investmentCount: number;
  testInvestmentCount: number;
  principalUgx: number;
  projectedProfitUgx: number;
  actualProfitUgx: number;
  totalValueUgx: number;
  differenceUgx: number;
  lateEntry: boolean;
  requestId: string;
};

export type CycleReturnState = ActionState & {
  preview?: CycleReturnPreview;
  savedRequestId?: string;
};

type CycleReturnSnapshot = {
  actual_return_bps: number | null;
  actual_return_revision: number;
  investment_count: number;
  test_investment_count: number;
  principal_ugx: number;
  projected_profit_ugx: number;
  actual_profit_ugx: number | null;
  total_value_ugx: number | null;
  difference_from_projection_ugx: number | null;
  late_entry: boolean;
  can_record: boolean;
  blocked_reason: string | null;
};

const INVALID_PERCENT =
  "Enter a return between 0% and 1,000% with up to two decimal places.";
const BLOCKED: Record<string, string> = {
  draft: "Draft cycles have no funded investments to apply a return to.",
  legacy_settlement:
    "Settlement already started on this cycle under the per-investment workflow, so it cannot adopt a cycle-wide return.",
  settled:
    "An investment in this cycle has already been settled, so its actual return can no longer be recorded.",
  locked: "The actual return is locked at maturity and can no longer be revised.",
};

async function hasAal2() {
  const supabase = await createClient();
  const { data, error } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return !error && data?.currentLevel === "aal2";
}

const previewSchema = z.object({
  cycleId: z.uuid(),
  actualReturnPercent: z.string(),
});

export async function previewCycleActualReturn(
  _: CycleReturnState,
  formData: FormData,
): Promise<CycleReturnState> {
  const profile = await requireAdmin();
  if (!(await hasAal2()))
    return {
      ok: false,
      message: "Complete administrator two-factor authentication first.",
    };
  const parsed = previewSchema.safeParse({
    cycleId: formData.get("cycleId"),
    actualReturnPercent: formData.get("actualReturnPercent") ?? "",
  });
  const bps = parsed.success
    ? parsePercentToBps(parsed.data.actualReturnPercent)
    : null;
  if (!parsed.success || bps === null)
    return { ok: false, message: INVALID_PERCENT };
  const { data, error } = await createAdminClient().rpc(
    "preview_cycle_actual_return",
    {
      p_admin_id: profile.id,
      p_admin_aal2: true,
      p_cycle_id: parsed.data.cycleId,
      p_actual_return_bps: bps,
    },
  );
  if (error || !data)
    return {
      ok: false,
      message: publicError(error, "The preview could not be prepared."),
    };
  const snapshot = data as unknown as CycleReturnSnapshot;
  if (!snapshot.can_record)
    return {
      ok: false,
      message:
        BLOCKED[snapshot.blocked_reason ?? ""] ??
        "The actual return cannot be recorded for this cycle.",
    };
  return {
    ok: true,
    message: "Review the affected totals, then confirm to save.",
    preview: {
      cycleId: parsed.data.cycleId,
      actualReturnBps: bps,
      previousActualReturnBps: snapshot.actual_return_bps,
      revision: snapshot.actual_return_revision,
      investmentCount: Number(snapshot.investment_count),
      testInvestmentCount: Number(snapshot.test_investment_count),
      principalUgx: Number(snapshot.principal_ugx),
      projectedProfitUgx: Number(snapshot.projected_profit_ugx),
      actualProfitUgx: Number(snapshot.actual_profit_ugx ?? 0),
      totalValueUgx: Number(snapshot.total_value_ugx ?? 0),
      differenceUgx: Number(snapshot.difference_from_projection_ugx ?? 0),
      lateEntry: snapshot.late_entry,
      requestId: requestId(),
    },
  };
}

const recordSchema = z.object({
  cycleId: z.uuid(),
  actualReturnBps: z.coerce.number().int().min(0).max(100_000),
  expectedRevision: z.coerce.number().int().min(0),
  expectedInvestmentCount: z.coerce.number().int().min(0),
  expectedPrincipalUgx: z
    .string()
    .trim()
    .regex(/^\d+(?:\.\d{1,8})?$/),
  requestId: z.uuid(),
  confirmed: z.literal("yes"),
});

export async function recordCycleActualReturn(
  previous: CycleReturnState,
  formData: FormData,
): Promise<CycleReturnState> {
  const profile = await requireAdmin();
  if (!(await hasAal2()))
    return {
      ok: false,
      message: "Complete administrator two-factor authentication first.",
      preview: previous.preview,
    };
  const parsed = recordSchema.safeParse(
    Object.fromEntries(
      [
        "cycleId",
        "actualReturnBps",
        "expectedRevision",
        "expectedInvestmentCount",
        "expectedPrincipalUgx",
        "requestId",
        "confirmed",
      ].map((key) => [key, formData.get(key) ?? ""]),
    ),
  );
  if (!parsed.success)
    return {
      ok: false,
      message: "Confirm the previewed totals before saving the actual return.",
      preview: previous.preview,
    };
  const input = parsed.data;
  const { error } = await createAdminClient().rpc(
    "record_cycle_actual_return",
    {
      p_admin_id: profile.id,
      p_admin_aal2: true,
      p_cycle_id: input.cycleId,
      p_actual_return_bps: input.actualReturnBps,
      p_expected_revision: input.expectedRevision,
      p_expected_investment_count: input.expectedInvestmentCount,
      p_expected_principal_ugx: Number(input.expectedPrincipalUgx),
      p_confirmed: true,
      p_request_id: input.requestId,
    },
  );
  if (error)
    return {
      ok: false,
      message: publicError(
        error,
        "The actual return could not be saved. No changes were made.",
      ),
    };
  revalidatePath("/admin/cycles");
  revalidatePath("/admin/maturities");
  revalidatePath("/admin");
  revalidatePath("/dashboard");
  revalidatePath("/investments", "layout");
  return {
    ok: true,
    savedRequestId: input.requestId,
    message:
      "Actual return saved. Partners see it now; payouts still follow the scheduled payout date.",
  };
}
