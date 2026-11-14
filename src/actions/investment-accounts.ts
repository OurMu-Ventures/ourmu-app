"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireInvestor } from "@/lib/auth";
import { requestId } from "@/lib/db";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ActionState } from "@/lib/validation";

const schema = z.object({
  accountId: z.union([z.uuid(), z.literal("")]),
  name: z.string().trim().min(1).max(80),
  archive: z.boolean(),
});

export async function saveInvestmentAccount(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireInvestor();
  const parsed = schema.safeParse({
    accountId: formData.get("accountId") ?? "",
    name: formData.get("name"),
    archive: formData.get("archive") === "true",
  });
  if (!parsed.success)
    return { ok: false, message: "Enter an account name of 1–80 characters." };
  if (
    !parsed.data.accountId &&
    process.env.MULTIPLE_INVESTMENT_ACCOUNTS_ENABLED !== "true"
  )
    return {
      ok: false,
      message: "Opening additional accounts is not available yet.",
    };
  const operationId = requestId();
  const { data, error } = await createAdminClient().rpc(
    "manage_investment_account",
    {
      p_investor_id: profile.id,
      p_name: parsed.data.name,
      p_request_id: operationId,
      p_account_id: parsed.data.accountId || undefined,
      p_archive: parsed.data.archive,
    },
  );
  if (error || !data) {
    const messages: Record<string, string> = {
      "partner unavailable":
        "Your partner access is unavailable. Refresh or contact support.",
      "investment account unavailable":
        "This account is unavailable or has been archived. Refresh and choose an active account.",
      "Main Account cannot be archived":
        "Main Account must stay open. You can rename it instead.",
      "account has outstanding investments":
        "Settle this account's pending reservations, active investments and maturity payouts before archiving it.",
    };
    const known =
      error?.message && Object.hasOwn(messages, error.message)
        ? messages[error.message]
        : undefined;
    console.error("investment_account.save_failed", {
      requestId: operationId,
      code:
        error?.code && /^[A-Z0-9]{5}$/.test(error.code)
          ? error.code
          : "UNKNOWN",
      recognized: Boolean(known || error?.code === "23505"),
    });
    return {
      ok: false,
      message:
        error?.code === "23505"
          ? "You already have an active account with that name."
          : (known ??
            `Could not save this account. Try again or contact support with reference ${operationId}.`),
    };
  }
  revalidatePath("/", "layout");
  redirect(`/accounts?account=${data}`);
}

const moveSchema = z.object({
  investmentId: z.uuid(),
  fromAccountId: z.uuid(),
  toAccountId: z.uuid(),
  requestId: z.uuid(),
});

export async function moveInvestmentAccount(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireInvestor();
  if (process.env.INVESTMENT_ACCOUNT_MOVES_ENABLED !== "true")
    return {
      ok: false,
      message: "Moving investments between accounts is not available yet.",
    };
  const parsed = moveSchema.safeParse({
    investmentId: formData.get("investmentId"),
    fromAccountId: formData.get("fromAccountId"),
    toAccountId: formData.get("toAccountId"),
    requestId: formData.get("requestId"),
  });
  if (!parsed.success)
    return { ok: false, message: "Choose the account to move this investment to." };
  // The browser's request ID makes a double submit or retry replay the
  // original move instead of applying it twice.
  const { error } = await createAdminClient().rpc("move_investment_account", {
    p_investor_id: profile.id,
    p_investment_id: parsed.data.investmentId,
    p_expected_account_id: parsed.data.fromAccountId,
    p_to_account_id: parsed.data.toAccountId,
    p_request_id: parsed.data.requestId,
  });
  if (error) {
    const messages: Record<string, string> = {
      "partner unavailable":
        "Your partner access is unavailable. Refresh or contact support.",
      "investment unavailable":
        "This investment is unavailable. Refresh and try again.",
      "investment already moved":
        "This investment has already moved to another account. Refresh to see where it is now.",
      "investment cannot be moved":
        "Only reserved and active investments can be moved. Matured and closed investments stay in their account.",
      "investment already in account":
        "This investment is already in that account.",
      "investment account unavailable":
        "That account is unavailable or has been archived. Refresh and choose an open account.",
    };
    const known = Object.hasOwn(messages, error.message)
      ? messages[error.message]
      : undefined;
    console.error("investment_account.move_failed", {
      requestId: parsed.data.requestId,
      code: /^[A-Z0-9]{5}$/.test(error.code ?? "") ? error.code : "UNKNOWN",
      recognized: Boolean(known),
    });
    return {
      ok: false,
      message:
        known ??
        `Could not move this investment. Try again or contact support with reference ${parsed.data.requestId}.`,
    };
  }
  revalidatePath("/", "layout");
  redirect(`/investments/${parsed.data.investmentId}?moved=1`);
}
