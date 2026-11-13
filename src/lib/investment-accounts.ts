import "server-only";

import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function getInvestmentAccounts(investorId: string) {
  const client = await createClient();
  const { data, error } = await client
    .from("investment_accounts")
    .select("id,name,is_default,archived_at")
    .eq("investor_id", investorId)
    .order("created_at");
  if (error || !data) throw new Error("Could not load investment accounts.");
  return data;
}

export async function resolveInvestmentAccount(
  investorId: string,
  requested?: string,
) {
  const accounts = await getInvestmentAccounts(investorId);
  const selected =
    requested === "all"
      ? null
      : requested
        ? accounts.find((account) => account.id === requested)
        : accounts.find((account) => account.is_default);
  if (selected === undefined) notFound();
  return { accounts, selected };
}

export function accountHref(path: string, accountId: string | null) {
  return `${path}?account=${encodeURIComponent(accountId ?? "all")}`;
}
