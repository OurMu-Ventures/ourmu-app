import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ requireInvestor: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/receipts/generate", () => ({ ensureReceiptPdf: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

import { downloadInvestmentReceipt } from "@/actions/receipts";
import { requireInvestor } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureReceiptPdf, type ReceiptRow } from "@/lib/receipts/generate";
import { initialActionState } from "@/lib/validation";

const investmentId = "71000000-0000-4000-8000-000000000003";
const receipt = {
  id: "receipt-1",
  investor_id: "owner-1",
  investment_id: investmentId,
  source: "investment_record",
  pdf_status: "generating",
  pdf_path: null,
  receipt_number: "OURMU-2026-000001",
} as ReceiptRow;
const rpc = vi.fn();
const single = vi.fn();
const eq = vi.fn();
const sign = vi.fn();
const from = vi.fn();

function form(id = investmentId) {
  const data = new FormData();
  data.set("investmentId", id);
  // Must never be trusted.
  data.set("investorId", "someone-else");
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireInvestor).mockResolvedValue({ id: "owner-1" } as Awaited<
    ReturnType<typeof requireInvestor>
  >);
  rpc.mockResolvedValue({ data: receipt.id, error: null });
  single.mockResolvedValue({ data: receipt, error: null });
  eq.mockReturnValue({ eq, single });
  from.mockReturnValue({ select: () => ({ eq }) });
  sign.mockResolvedValue({
    data: { signedUrl: "https://storage.example/receipt.pdf" },
    error: null,
  });
  vi.mocked(createAdminClient).mockReturnValue({
    rpc,
    from,
    storage: { from: () => ({ createSignedUrl: sign }) },
  } as unknown as ReturnType<typeof createAdminClient>);
  vi.mocked(ensureReceiptPdf).mockResolvedValue({
    ...receipt,
    pdf_status: "ready",
    pdf_path: "owner-1/receipt-1.pdf",
  });
});

describe("on-demand investment receipt download", () => {
  it("issues for the authenticated owner, prepares the PDF and downloads it", async () => {
    await expect(
      downloadInvestmentReceipt(initialActionState, form()),
    ).rejects.toThrow("REDIRECT:https://storage.example/receipt.pdf");
    expect(rpc).toHaveBeenCalledWith("ensure_investment_receipt", {
      p_investor_id: "owner-1",
      p_investment_id: investmentId,
    });
    expect(eq).toHaveBeenCalledWith("investor_id", "owner-1");
    expect(eq).toHaveBeenCalledWith("investment_id", investmentId);
    expect(sign).toHaveBeenCalledWith("owner-1/receipt-1.pdf", 60, {
      download: "OURMU-2026-000001.pdf",
    });
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("investment_receipts");
  });

  it("rejects invalid IDs before issuing a receipt", async () => {
    expect(
      (await downloadInvestmentReceipt(initialActionState, form("invalid"))).ok,
    ).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not access PDFs when issuance is denied for another owner or an unpaid reservation", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0002" } });
    expect(
      (await downloadInvestmentReceipt(initialActionState, form())).ok,
    ).toBe(false);
    expect(from).not.toHaveBeenCalled();
    expect(ensureReceiptPdf).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
  });

  it("does not sign a link if the receipt lookup fails", async () => {
    single.mockResolvedValue({ data: null, error: { message: "read failed" } });
    expect(
      (await downloadInvestmentReceipt(initialActionState, form())).ok,
    ).toBe(false);
    expect(ensureReceiptPdf).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
  });

  it("returns an actionable error and allows a failed generation to be retried", async () => {
    vi.mocked(ensureReceiptPdf).mockRejectedValueOnce(
      new Error("PDF_UPLOAD_FAILED"),
    );
    const failed = await downloadInvestmentReceipt(initialActionState, form());
    expect(failed.ok).toBe(false);
    expect(failed.message).toContain("try Download receipt again");
    expect(sign).not.toHaveBeenCalled();
    await expect(downloadInvestmentReceipt(failed, form())).rejects.toThrow(
      "REDIRECT:",
    );
  });

  it("reports signing failures without exposing internal errors", async () => {
    sign.mockResolvedValue({
      data: null,
      error: { message: "private storage details" },
    });
    const result = await downloadInvestmentReceipt(initialActionState, form());
    expect(result.ok).toBe(false);
    expect(result.message).not.toContain("private storage details");
  });
});
