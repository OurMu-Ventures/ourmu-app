import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/auth", () => ({
  requireInvestor: vi.fn(),
  requireAdmin: vi.fn(),
}));
vi.mock("@/lib/deposit-slips", () => ({ slipClient: vi.fn() }));
vi.mock("@/lib/deposit-slip-validation", () => ({
  SLIP_TYPES: ["image/jpeg", "application/pdf"],
  validateDepositSlip: vi.fn(),
}));
import { requireInvestor, requireAdmin } from "@/lib/auth";
import { slipClient } from "@/lib/deposit-slips";
import { reserveDepositSlip, viewDepositSlip } from "@/actions/deposit-slips";
const investor = "b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2";
const investment = "a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1";
const attachment = "c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3";
describe("deposit slip action authorization", () => {
  let origin: string;
  const rpc = vi.fn(),
    from = vi.fn(),
    sign = vi.fn();
  beforeEach(() => {
    origin = "portal";
    vi.stubEnv("DEPOSIT_SLIPS_ENABLED", "true");
    vi.mocked(requireInvestor)
      .mockReset()
      .mockResolvedValue({ id: investor, role: "investor" } as Awaited<
        ReturnType<typeof requireInvestor>
      >);
    vi.mocked(requireAdmin).mockReset();
    rpc
      .mockReset()
      .mockResolvedValue({ data: { id: attachment }, error: null });
    sign
      .mockReset()
      .mockResolvedValue({ data: { signedUrl: "signed" }, error: null });
    from.mockReset().mockImplementation((table: string) => {
      const q = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gt: vi.fn().mockReturnThis(),
        single: async () => ({
          data: {
            id: investment,
            investor_id: investor,
            status: "reserved",
            record_origin: origin,
          },
        }),
        maybeSingle: async () => ({
          data: table === "deposit_slips" ? { path: "private/path" } : null,
        }),
      };
      return q;
    });
    vi.mocked(slipClient).mockReturnValue({
      from,
      rpc,
      storage: { from: () => ({ createSignedUrl: sign }) },
    } as unknown as ReturnType<typeof slipClient>);
  });
  afterEach(() => vi.unstubAllEnvs());
  it("rejects hybrid reservations before reserving storage", async () => {
    origin = "hybrid";
    await expect(
      reserveDepositSlip(investment, "image/jpeg", 100),
    ).rejects.toThrow("Reservation unavailable");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("blocks new slots when the rollout flag is off", async () => {
    vi.stubEnv("DEPOSIT_SLIPS_ENABLED", "false");
    await expect(
      reserveDepositSlip(investment, "image/jpeg", 100),
    ).rejects.toThrow("temporarily unavailable");
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([
    "Three attachments maximum",
    "Uploads temporarily full. Investment processing continues",
    "Previous uploads awaiting cleanup. Please try again later",
    "Reservation unavailable",
  ])("reports the actionable error: %s", async (message) => {
    rpc.mockResolvedValue({ error: { message } });
    await expect(
      reserveDepositSlip(investment, "image/jpeg", 100),
    ).rejects.toThrow(message);
  });
  it("authorizes once and queries one attachment for viewing", async () => {
    expect(await viewDepositSlip(investment, attachment)).toBe("signed");
    expect(requireInvestor).toHaveBeenCalledTimes(1);
    expect(from.mock.calls.map((c) => c[0])).toEqual([
      "investments",
      "deposit_slips",
    ]);
    expect(sign).toHaveBeenCalledWith("private/path", 60);
  });
});
