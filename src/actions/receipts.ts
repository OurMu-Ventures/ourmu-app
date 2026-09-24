"use server";

import { requireInvestor } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function getReceiptDownloadUrl(receiptId: string) {
  const profile = await requireInvestor();
  const admin = createAdminClient();
  let query = (admin as never as ReturnType<typeof createAdminClient>)
    .from("investment_receipts" as never)
    .select("pdf_path,pdf_status,investor_id")
    .eq("id", receiptId);
  if (profile.role !== "admin") query = query.eq("investor_id", profile.id);
  const { data } = await (query as never as { single: () => Promise<{ data: { pdf_path: string | null; pdf_status: string } | null }> }).single();
  if (!data?.pdf_path || data.pdf_status !== "ready") return null;
  const { data: signed } = await admin.storage
    .from("receipts")
    .createSignedUrl(data.pdf_path, 60);
  return signed?.signedUrl ?? null;
}
