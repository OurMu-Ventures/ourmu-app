"use server";

import { requireInvestor } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ensureReceiptPdf } from "@/lib/receipts/generate";
import type { ActionState } from "@/lib/validation";

export async function downloadInvestmentReceipt(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireInvestor();
  const parsed = z.uuid().safeParse(formData.get("investmentId"));
  if (!parsed.success)
    return { ok: false, message: "Investment unavailable. Refresh and try again." };

  let url: string;
  try {
    const admin = createAdminClient();
    // The RPC checks ownership and investment status and serializes issuance.
    // Both IDs come from trusted authentication/validated input, never a
    // caller-supplied receipt snapshot or investor ID.
    const { data: receiptId, error: issueError } = await admin.rpc(
      "ensure_investment_receipt",
      { p_investor_id: profile.id, p_investment_id: parsed.data },
    );
    if (issueError || !receiptId) throw new Error("RECEIPT_UNAVAILABLE");
    const { data: receipt, error: readError } = await admin
      .from("investment_receipts")
      .select("*")
      .eq("id", receiptId)
      .eq("investment_id", parsed.data)
      .eq("investor_id", profile.id)
      .single();
    if (readError || !receipt) throw new Error("RECEIPT_UNAVAILABLE");
    const ready = await ensureReceiptPdf(admin, receipt);
    if (!ready.pdf_path) throw new Error("RECEIPT_UNAVAILABLE");
    const { data: signed, error: signError } = await admin.storage
      .from("receipts")
      .createSignedUrl(ready.pdf_path, 60, {
        download: `${ready.receipt_number}.pdf`,
      });
    if (signError || !signed?.signedUrl) throw new Error("RECEIPT_UNAVAILABLE");
    url = signed.signedUrl;
  } catch {
    return {
      ok: false,
      message:
        "Could not prepare your receipt. Please try Download receipt again. If the problem continues, contact OURMU staff.",
    };
  }
  revalidatePath(`/investments/${parsed.data}`);
  redirect(url);
}

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
