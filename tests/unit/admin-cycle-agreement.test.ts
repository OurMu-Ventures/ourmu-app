import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAdmin: async () => ({ id: "admin-1" }) }));
vi.mock("@/lib/db", () => ({ audit: vi.fn(), requestId: () => "request-1" }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const state = vi.hoisted(() => ({
  agreement: { id: "latest-agreement", template_markdown: "Approved agreement" } as
    | { id: string; template_markdown: string }
    | null,
  inserted: null as Record<string, unknown> | null,
  updated: null as Record<string, unknown> | null,
  agreementOrders: [] as Array<[string, boolean]>,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        not: () => query,
        order: (field: string, options: { ascending: boolean }) => {
          if (table === "agreement_versions")
            state.agreementOrders.push([field, options.ascending]);
          return query;
        },
        limit: () => query,
        insert: (value: Record<string, unknown>) => {
          state.inserted = value;
          return query;
        },
        update: (value: Record<string, unknown>) => {
          state.updated = value;
          return query;
        },
        maybeSingle: async () => ({
          data: table === "agreement_versions" ? state.agreement : { id: "cycle-1" },
          error: null,
        }),
        single: async () => ({ data: { id: "cycle-1" }, error: null }),
      };
      return query;
    },
  }),
}));

import { createCycle, updateCycle } from "@/actions/admin";

function cycleForm() {
  const form = new FormData();
  form.set("cycleId", "11111111-1111-4111-8111-111111111111");
  form.set("name", "October 2026");
  form.set("opensAt", "2026-10-01");
  form.set("closesAt", "2026-10-15");
  form.set("maturityDate", "2027-03-15");
  form.set("capacityUgx", "125000");
  form.set("agreementVersionId", "stale-client-value");
  return form;
}

beforeEach(() => {
  state.agreement = { id: "latest-agreement", template_markdown: "Approved agreement" };
  state.inserted = null;
  state.updated = null;
  state.agreementOrders = [];
});

describe("admin cycle agreement selection", () => {
  it("uses the latest published agreement for creation and ignores client input", async () => {
    const result = await createCycle({ ok: false, message: "" }, cycleForm());
    expect(result.ok).toBe(true);
    expect(state.inserted?.agreement_version_id).toBe("latest-agreement");
    expect(state.agreementOrders).toEqual([
      ["published_at", false],
      ["created_at", false],
    ]);
  });

  it("uses the latest agreement when editing a draft", async () => {
    const result = await updateCycle({ ok: false, message: "" }, cycleForm());
    expect(result.ok).toBe(true);
    expect(state.updated?.agreement_version_id).toBe("latest-agreement");
  });

  it("explains when no approved agreement is available", async () => {
    state.agreement = null;
    const result = await createCycle({ ok: false, message: "" }, cycleForm());
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("Publish") });
    expect(state.inserted).toBeNull();
  });

  it("explains the payout-day rule when maturity falls after the 15th", async () => {
    const form = cycleForm();
    form.set("maturityDate", "2027-03-31");
    expect(await createCycle({ ok: false, message: "" }, form)).toMatchObject({
      ok: false,
      message: "Maturity date must be on or before the 15th of its month.",
    });
    expect(state.inserted).toBeNull();
  });

  it("identifies an invalid capacity", async () => {
    const form = cycleForm();
    form.set("capacityUgx", "100000");
    expect(await createCycle({ ok: false, message: "" }, form)).toMatchObject({
      ok: false,
      message: "Enter a capacity of at least UGX 125,000 with at most two decimal places.",
    });
  });

  it("identifies a closing date before the opening date", async () => {
    const form = cycleForm();
    form.set("closesAt", "2026-09-30");
    expect(await createCycle({ ok: false, message: "" }, form)).toMatchObject({
      ok: false,
      message: "Closing date must be on or after the opening date.",
    });
  });
});
