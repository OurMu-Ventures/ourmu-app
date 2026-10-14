import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({
  requireInvestor: vi.fn(),
  requireAdmin: vi.fn(),
}));
vi.mock("@/lib/security/crypto", () => ({ fingerprintRequestValue: vi.fn() }));
vi.mock("@/lib/db", () => ({
  requestId: vi.fn(),
  toBytea: vi.fn(),
  publicError: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { renameInvestment } from "@/actions/investments";
import { requireInvestor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

const investmentId = "00000000-0000-4000-8000-000000000001";
const read = vi.fn();
const update = vi.fn();
const readQuery = {
  select: vi.fn(() => ({
    eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: read })) })),
  })),
};
const updateQuery = {
  update: vi.fn(() => ({
    eq: vi.fn(() => ({
      eq: vi.fn(() => ({ select: vi.fn(() => ({ maybeSingle: update })) })),
    })),
  })),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireInvestor).mockResolvedValue({ id: "owner-1" } as Awaited<
    ReturnType<typeof requireInvestor>
  >);
  vi.mocked(createClient).mockResolvedValue({
    from: () => readQuery,
  } as unknown as Awaited<ReturnType<typeof createClient>>);
  vi.mocked(createAdminClient).mockReturnValue({
    from: () => updateQuery,
  } as unknown as ReturnType<typeof createAdminClient>);
  read.mockResolvedValue({ data: { id: investmentId }, error: null });
  update.mockResolvedValue({ data: { id: investmentId }, error: null });
});

describe("renameInvestment", () => {
  it("trims and saves an alias, then revalidates all partner views", async () => {
    expect(
      await renameInvestment({ investmentId, alias: "  Savings A  " }),
    ).toEqual({ ok: true, alias: "Savings A" });
    expect(updateQuery.update).toHaveBeenCalledWith({ alias: "Savings A" });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
    expect(revalidatePath).toHaveBeenCalledWith("/investments");
    expect(revalidatePath).toHaveBeenCalledWith(`/investments/${investmentId}`);
  });

  it("clears an alias and rejects names longer than 80 characters", async () => {
    expect(await renameInvestment({ investmentId, alias: "   " })).toEqual({
      ok: true,
      alias: null,
    });
    expect(updateQuery.update).toHaveBeenCalledWith({ alias: null });
    expect(
      (await renameInvestment({ investmentId, alias: "x".repeat(81) })).ok,
    ).toBe(false);
    expect(updateQuery.update).toHaveBeenCalledTimes(1);
  });

  it("does not update an investment that is not visible to the partner", async () => {
    read.mockResolvedValue({ data: null, error: null });
    expect((await renameInvestment({ investmentId, alias: "Hidden" })).ok).toBe(
      false,
    );
    expect(updateQuery.update).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
