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
