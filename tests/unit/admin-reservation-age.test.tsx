// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  oldest: null as { requested_at: string } | null,
  calls: [] as Array<{ method: string; args: unknown[] }>,
  error: false,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/actions/admin", () => ({ resolveClosure: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/components/SubmitButton", () => ({
  SubmitButton: () => <button>Submit</button>,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      let selection = "";
      const query = {
        select: (value: string) => {
          selection = value;
          return query;
        },
        eq: (...args: unknown[]) => {
          state.calls.push({ method: "eq", args });
          return query;
        },
        in: () => query,
        order: (...args: unknown[]) => {
          state.calls.push({ method: "order", args });
          return query;
        },
        limit: (...args: unknown[]) => {
          state.calls.push({ method: "limit", args });
          return query;
        },
        maybeSingle: async () => ({
          data: selection === "requested_at" ? state.oldest : null,
          error:
            selection === "requested_at" && state.error
              ? { message: "Unavailable" }
              : null,
        }),
        then: (resolve: (result: unknown) => unknown) =>
          Promise.resolve({ data: [], count: 0 }).then(resolve),
      };
      return query;
    },
  }),
}));
import AdminPage from "@/app/(admin)/admin/(console)/page";
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-03T12:00:00Z"));
  state.oldest = null;
  state.calls = [];
  state.error = false;
});
afterEach(() => vi.useRealTimers());
describe("pending reservation aging", () => {
  it("shows no oldest age for an empty queue", async () => {
    const html = renderToStaticMarkup(await AdminPage());
    expect(html).toContain("Oldest pending: <strong>None</strong>");
  });
  it("highlights the three-day review threshold and loads the oldest non-test pending reservation", async () => {
    state.oldest = { requested_at: "2026-09-30T12:00:00Z" };
    const html = renderToStaticMarkup(await AdminPage());
    expect(html).toContain("Oldest pending: <strong>3 days</strong>");
    expect(html).toContain('class="notice">Review pending reservations daily');
    expect(state.calls).toContainEqual({
      method: "eq",
      args: ["status", "reserved"],
    });
    expect(state.calls).toContainEqual({
      method: "eq",
      args: ["is_test", false],
    });
    expect(state.calls).toContainEqual({
      method: "order",
      args: ["requested_at", { ascending: true }],
    });
    expect(state.calls).toContainEqual({ method: "limit", args: [1] });
  });
  it("does not present a query failure as an empty queue", async () => {
    state.error = true;
    await expect(AdminPage()).rejects.toThrow(
      "Unable to load the oldest pending reservation",
    );
  });
});
