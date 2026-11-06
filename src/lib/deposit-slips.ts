import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
export type DepositSlip = {
  id: string;
  investment_id: string;
  investor_id: string;
  path: string;
  mime: string;
  bytes: number;
  state: string;
  created_at: string;
  expires_at: string;
};
// New schema is accessed through an isolated untyped boundary until generated types are refreshed.
export function slipClient(signal?: AbortSignal) {
  return createAdminClient(
    signal,
  ) as unknown as import("@supabase/supabase-js").SupabaseClient;
}
export async function cleanupDepositSlips() {
  const db = slipClient(AbortSignal.timeout(10000));
  const { data, error } = await db.rpc("deposit_slip_cleanup_candidates");
  if (error) throw new Error("Deposit slip cleanup query failed");
  let deleted = 0,
    failed = 0;
  const slips = (data ?? []) as DepositSlip[];
  if (slips.length) {
    const removed = await db.storage
      .from("deposit-slips")
      .remove(slips.map((d) => d.path));
    if (removed.error) failed += slips.length;
    else {
      const result = await db
        .from("deposit_slips")
        .update({ state: "deleted" })
        .in(
          "id",
          slips.map((d) => d.id),
        )
        .eq("state", "deleting");
      if (result.error) failed += slips.length;
      else deleted += slips.length;
    }
  }
  const orphans = await db.rpc("deposit_slip_orphan_paths");
  if (orphans.error) failed++;
  else if (orphans.data?.length) {
    const result = await db.storage
      .from("deposit-slips")
      .remove(orphans.data.map((row: { path: string }) => row.path));
    if (result.error) failed++;
    else deleted += orphans.data.length;
  }
  return { deleted, failed };
}
