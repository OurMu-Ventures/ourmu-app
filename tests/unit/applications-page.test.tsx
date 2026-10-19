// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applicationPage,
  applicationView,
  applicationDate,
  applicationDateTime,
} from "@/lib/application-views";
const state = vi.hoisted(() => ({
  calls: [] as unknown[][],
  count: 26,
  pendingCount: 45,
  fail: false,
  outOfRange: false,
  rangeStart: 0,
}));
vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/components/ApplicationsWorkspace", () => ({
  ApplicationsWorkspace: () => null,
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      let head = false;
      state.calls.push(["from", table]);
      const query = {
        select: (fields: string, options: { head?: boolean }) => {
          head = Boolean(options.head);
          state.calls.push(["select", fields, options]);
          return query;
        },
        eq: (...args: unknown[]) => {
          state.calls.push(["eq", ...args]);
          return query;
        },
        in: (...args: unknown[]) => {
          state.calls.push(["in", ...args]);
          return query;
        },
        order: (...args: unknown[]) => {
          state.calls.push(["order", ...args]);
          return query;
        },
        range: (...args: unknown[]) => {
          state.calls.push(["range", ...args]);
          state.rangeStart = args[0] as number;
          return query;
        },
        then: (resolve: (result: unknown) => unknown) =>
          Promise.resolve({
            data: [],
            count: head ? state.pendingCount : state.count,
            error: state.fail
              ? { message: "failure" }
              : state.outOfRange && !head && state.rangeStart >= state.count
                ? {
                    code: "PGRST103",
                    message: "Requested range not satisfiable",
                  }
                : null,
          }).then(resolve),
      };
      return query;
    },
  }),
}));
import ApplicationsPage from "@/app/(admin)/admin/(console)/applications/page";
import InvitationsPage from "@/app/(admin)/admin/(console)/invitations/page";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
beforeEach(() => {
  state.calls = [];
  state.count = 26;
  state.pendingCount = 45;
  state.fail = false;
  state.outOfRange = false;
  state.rangeStart = 0;
  vi.clearAllMocks();
});
describe("applications data and routing", () => {
  it("defaults to oldest submitted applications and counts all pending records", async () => {
    const page = await ApplicationsPage({});
    expect(page.props.tab).toBe("review");
    expect(page.props.pendingCount).toBe(45);
    expect(state.calls).toContainEqual([
      "select",
      "id",
      { count: "exact", head: true },
    ]);
    expect(state.calls).toContainEqual(["eq", "status", "submitted"]);
    expect(state.calls).toContainEqual([
      "order",
      "created_at",
      { ascending: true },
    ]);
    expect(state.calls).toContainEqual(["range", 0, 24]);
    expect(requireAdmin).toHaveBeenCalledOnce();
  });
  it("paginates invitations without selecting token hashes", async () => {
    const page = await ApplicationsPage({
      searchParams: Promise.resolve({ tab: "invitations", page: "2" }),
    });
    expect(page.props.tab).toBe("invitations");
    expect(state.calls).toContainEqual(["from", "application_invitations"]);
    expect(state.calls).toContainEqual(["range", 25, 49]);
    expect(state.calls).toContainEqual([
      "order",
      "created_at",
      { ascending: false },
    ]);
    expect(JSON.stringify(state.calls)).not.toContain("token_hash");
  });
  it("filters history and corrects a page emptied by a completed review", async () => {
    state.count = 25;
    state.outOfRange = true;
    const page = await ApplicationsPage({
      searchParams: Promise.resolve({ tab: "history", page: "2" }),
    });
    expect(state.calls).toContainEqual([
      "in",
      "status",
      ["approved", "rejected", "abandoned"],
    ]);
    expect(state.calls).toContainEqual(["range", 0, 24]);
    expect(page.props.page).toBe(1);
    expect(page.props.loadError).toBe(false);
  });
  it("recovers a stale high page URL by fetching the actual final page", async () => {
    state.count = 76;
    state.outOfRange = true;
    const page = await ApplicationsPage({
      searchParams: Promise.resolve({ tab: "invitations", page: "9" }),
    });
    expect(state.calls).toContainEqual(["range", 200, 224]);
    expect(state.calls).toContainEqual(["range", 0, 24]);
    expect(state.calls).toContainEqual(["range", 75, 99]);
    expect(page.props.page).toBe(4);
    expect(page.props.loadError).toBe(false);
  });
  it("reports query failures instead of empty success", async () => {
    state.fail = true;
    const page = await ApplicationsPage({});
    expect(page.props.loadError).toBe(true);
    expect(page.props.pendingCount).toBeNull();
  });
  it("redirects the old invitations route after checking admin access", async () => {
    await InvitationsPage();
    expect(requireAdmin).toHaveBeenCalledOnce();
    expect(redirect).toHaveBeenCalledWith(
      "/admin/applications?tab=invitations",
    );
  });
  it("normalizes invalid URL state", () => {
    expect(applicationView("unknown")).toBe("review");
    for (const value of [
      "0",
      "-2",
      "NaN",
      "1.5",
      "100000000000000000",
      ["2", "3"],
    ])
      expect(applicationPage(value)).toBe(1);
  });
});

it("formats calendar dates and activity timestamps consistently across time zones", () => {
  expect(applicationDate("1990-01-01")).toBe("1 Jan 1990");
  expect(applicationDateTime("2026-10-15T10:00:00Z")).toBe(
    "15 Oct 2026, 13:00",
  );
});
