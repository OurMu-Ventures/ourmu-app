import "server-only";

import { cache } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const getInvestmentAccounts = cache(async (investorId: string) => {
  const client = await createClient();
  const { data, error } = await client
    .from("investment_accounts")
    .select("id,name,is_default,archived_at")
    .eq("investor_id", investorId)
    .order("created_at");
  if (error || !data) throw new Error("Could not load investment accounts.");
  return data;
});

export async function resolveInvestmentAccount(
  investorId: string,
  requested?: string,
) {
  const accounts = await getInvestmentAccounts(investorId);
  const selected =
    !requested || requested === "all"
      ? null
      : accounts.find((account) => account.id === requested);
  if (selected === undefined) notFound();
  return { accounts, selected };
}

export { accountHref } from "@/lib/investment-account-context";
