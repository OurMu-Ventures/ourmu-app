import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(),
  requireInvestor: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/receipts/generate", () => ({ ensureReceiptPdf: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

import { downloadAdminReceipt } from "@/actions/receipts";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureReceiptPdf } from "@/lib/receipts/generate";
import { initialActionState } from "@/lib/validation";

const receiptId = "9d1c7f9e-2b4d-4e6f-8a0b-1c2d3e4f5a6b";
const single = vi.fn();
const eq = vi.fn();
const sign = vi.fn();
const from = vi.fn();

function form(id = receiptId) {
  const data = new FormData();
  data.set("receiptId", id);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue({ id: "admin-1" } as Awaited<
    ReturnType<typeof requireAdmin>
  >);
  single.mockResolvedValue({
    data: {
      pdf_path: "owner-1/receipt-1.pdf",
      pdf_status: "ready",
      receipt_number: "OURMU-2026-000123",
    },
    error: null,
  });
  eq.mockReturnValue({ single });
  from.mockReturnValue({ select: () => ({ eq }) });
  sign.mockResolvedValue({
    data: { signedUrl: "https://storage.example/receipt.pdf" },
    error: null,
  });
  vi.mocked(createAdminClient).mockReturnValue({
    from,
    storage: { from: () => ({ createSignedUrl: sign }) },
  } as unknown as ReturnType<typeof createAdminClient>);
});

describe("admin receipt download", () => {
  it("requires an administrator before reading anything", async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce(
      new Error("REDIRECT:/dashboard"),
    );
    await expect(
      downloadAdminReceipt(initialActionState, form()),
    ).rejects.toThrow("REDIRECT:/dashboard");
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("mints a short-lived download link on click", async () => {
    await expect(
      downloadAdminReceipt(initialActionState, form()),
    ).rejects.toThrow("REDIRECT:https://storage.example/receipt.pdf");
    expect(from).toHaveBeenCalledWith("investment_receipts");
    expect(eq).toHaveBeenCalledWith("id", receiptId);
    expect(sign).toHaveBeenCalledWith("owner-1/receipt-1.pdf", 60, {
      download: "OURMU-2026-000123.pdf",
    });
  });

  it("rejects invalid IDs without a lookup", async () => {
    const result = await downloadAdminReceipt(initialActionState, form("x"));
    expect(result.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("never generates or signs a receipt that is not ready", async () => {
    single.mockResolvedValue({
      data: { pdf_path: null, pdf_status: "failed", receipt_number: "R" },
      error: null,
    });
    const result = await downloadAdminReceipt(initialActionState, form());
    expect(result).toEqual({
      ok: false,
      message: "Could not prepare this receipt. Please try again.",
    });
    expect(sign).not.toHaveBeenCalled();
    expect(ensureReceiptPdf).not.toHaveBeenCalled();
  });

  it("reports signing failures without exposing storage details", async () => {
    sign.mockResolvedValue({
      data: null,
      error: { message: "private storage details" },
    });
    const result = await downloadAdminReceipt(initialActionState, form());
    expect(result.ok).toBe(false);
    expect(result.message).not.toContain("private storage details");
  });
});
