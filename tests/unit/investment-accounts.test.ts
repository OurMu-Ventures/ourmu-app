import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireInvestor: vi.fn() }));
vi.mock("@/lib/db", () => ({ requestId: () => "request-id" }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import {
  accountHref,
  resolveInvestmentAccount,
} from "@/lib/investment-accounts";
import {
  moveInvestmentAccount,
  saveInvestmentAccount,
} from "@/actions/investment-accounts";
import { requireInvestor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const main = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Main Account",
  is_default: true,
  archived_at: null,
};
const school = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "School Fees",
  is_default: false,
  archived_at: null,
};
const rpc = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("MULTIPLE_INVESTMENT_ACCOUNTS_ENABLED", "true");
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn().mockResolvedValue({ data: [main, school], error: null }),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  vi.mocked(createClient).mockResolvedValue({
    from: () => query,
  } as unknown as Awaited<ReturnType<typeof createClient>>);
  vi.mocked(requireInvestor).mockResolvedValue({ id: "owner-id" } as Awaited<
    ReturnType<typeof requireInvestor>
  >);
  vi.mocked(createAdminClient).mockReturnValue({ rpc } as unknown as ReturnType<
    typeof createAdminClient
  >);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("investment account context", () => {
  it("defaults existing links to All accounts", async () => {
    expect((await resolveInvestmentAccount("owner-id")).selected).toBeNull();
  });
  it("resolves a specific account and an explicit combined overview", async () => {
    expect(
      (await resolveInvestmentAccount("owner-id", school.id)).selected,
    ).toEqual(school);
    expect(
      (await resolveInvestmentAccount("owner-id", "all")).selected,
    ).toBeNull();
  });
  it("rejects unavailable accounts instead of silently showing a different balance", async () => {
    await expect(
      resolveInvestmentAccount("owner-id", "another-partner-account"),
    ).rejects.toThrow("NOT_FOUND");
  });
  it("keeps account context in financial links", () => {
    expect(accountHref("/investments/new", school.id)).toContain(
      `account=${school.id}`,
    );
    expect(accountHref("/dashboard", null)).toBe("/dashboard?account=all");
  });
});

describe("account management action", () => {
  function form(accountId = "") {
    const data = new FormData();
    data.set("accountId", accountId);
    data.set("name", " School Fees ");
    data.set("investorId", "forged-owner");
    return data;
  }
  it("uses the authenticated owner and database RPC for creation", async () => {
    rpc.mockResolvedValue({ data: school.id, error: null });
    await expect(
      saveInvestmentAccount({ ok: false, message: "" }, form()),
    ).rejects.toThrow(`REDIRECT:/accounts?account=${school.id}`);
    expect(rpc).toHaveBeenCalledWith(
      "manage_investment_account",
      expect.objectContaining({
        p_investor_id: "owner-id",
        p_name: "School Fees",
        p_archive: false,
      }),
    );
  });
  it("keeps creation disabled until rollout", async () => {
    vi.stubEnv("MULTIPLE_INVESTMENT_ACCOUNTS_ENABLED", "false");
    expect(
      (await saveInvestmentAccount({ ok: false, message: "" }, form())).ok,
    ).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("does not disable management of existing accounts when creation is paused", async () => {
    vi.stubEnv("MULTIPLE_INVESTMENT_ACCOUNTS_ENABLED", "false");
    rpc.mockResolvedValue({ data: school.id, error: null });
    await expect(
      saveInvestmentAccount({ ok: false, message: "" }, form(school.id)),
    ).rejects.toThrow("REDIRECT:");
  });
  it("handles duplicate names without exposing database details", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "23505", message: "private" },
    });
    const result = await saveInvestmentAccount(
      { ok: false, message: "" },
      form(),
    );
    expect(result.message).toContain("already have");
    expect(result.message).not.toContain("private");
  });
});

describe("account failure reporting", () => {
  it.each([
    ["partner unavailable", "partner access is unavailable"],
    ["investment account unavailable", "archived"],
    ["Main Account cannot be archived", "must stay open"],
    ["account has outstanding investments", "Settle this account"],
  ])("explains %s", async (message, expected) => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message } });
    const form = new FormData();
    form.set("name", "Private account name");
    form.set("accountId", school.id);
    const result = await saveInvestmentAccount(
      { ok: false, message: "" },
      form,
    );
    expect(result.message).toContain(expected);
    expect(console.error).toHaveBeenCalledWith(
      "investment_account.save_failed",
      { requestId: "request-id", code: "P0001", recognized: true },
    );
  });
  it("uses a generic support reference for unknown failures without logging private text", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: "PGRST001",
        message: "private account name or database detail",
      },
    });
    const form = new FormData();
    form.set("name", "private account name");
    const result = await saveInvestmentAccount(
      { ok: false, message: "" },
      form,
    );
    expect(result.message).toContain("reference request-id");
    expect(result.message).not.toContain("outstanding");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      "private",
    );
  });
});

describe("move investment action", () => {
  const investmentId = "33333333-3333-4333-8333-333333333333";
  const moveRequestId = "44444444-4444-4444-8444-444444444444";
  function form() {
    const data = new FormData();
    data.set("investmentId", investmentId);
    data.set("fromAccountId", main.id);
    data.set("toAccountId", school.id);
    data.set("requestId", moveRequestId);
    data.set("investorId", "forged-owner");
    return data;
  }
  beforeEach(() => vi.stubEnv("INVESTMENT_ACCOUNT_MOVES_ENABLED", "true"));
  it("moves through the database as the signed-in owner with the browser's request ID", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    await expect(
      moveInvestmentAccount({ ok: false, message: "" }, form()),
    ).rejects.toThrow(`REDIRECT:/investments/${investmentId}?moved=1`);
    expect(rpc).toHaveBeenCalledWith("move_investment_account", {
      p_investor_id: "owner-id",
      p_investment_id: investmentId,
      p_expected_account_id: main.id,
      p_to_account_id: school.id,
      p_request_id: moveRequestId,
    });
  });
  it("stays off until its own rollout flag is enabled", async () => {
    vi.stubEnv("INVESTMENT_ACCOUNT_MOVES_ENABLED", "false");
    const result = await moveInvestmentAccount(
      { ok: false, message: "" },
      form(),
    );
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects malformed submissions before calling the database", async () => {
    const data = form();
    data.set("toAccountId", "not-an-id");
    expect(
      (await moveInvestmentAccount({ ok: false, message: "" }, data)).ok,
    ).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("explains stale and ineligible moves", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "23514", message: "investment already moved" },
    });
    expect(
      (await moveInvestmentAccount({ ok: false, message: "" }, form())).message,
    ).toContain("already moved");
    rpc.mockResolvedValue({
      data: null,
      error: { code: "55000", message: "investment cannot be moved" },
    });
    expect(
      (await moveInvestmentAccount({ ok: false, message: "" }, form())).message,
    ).toContain("Only reserved and active investments");
  });
  it("gives a support reference for unexpected failures without database details", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "57014", message: "private timeout" },
    });
    const { message } = await moveInvestmentAccount(
      { ok: false, message: "" },
      form(),
    );
    expect(message).toContain(moveRequestId);
    expect(message).not.toContain("private");
  });
});
