// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  requireAdmin: vi.fn(async () => ({ id: "admin-1" })),
  rows: [] as Array<Record<string, unknown>>,
  error: false,
  calls: [] as Array<{ method: string; args: unknown[] }>,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ requireAdmin: state.requireAdmin }));
vi.mock("@/components/forms", () => ({
  ActivationForm: ({
    investmentId,
    expectedAmount,
  }: {
    investmentId: string;
    expectedAmount: number;
  }) => (
    <form data-investment={investmentId}>
      <input name="receivedAmountUgx" defaultValue={expectedAmount} />
      <button>Activate investment</button>
    </form>
  ),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      const orders: string[] = [];
      const record = (method: string, ...args: unknown[]) => {
        state.calls.push({ method, args });
        return query;
      };
      const query = {
        select: (...args: unknown[]) => record("select", ...args),
        eq: (field: string, value: unknown) => {
          filters.push((row) => row[field] === value);
          return record("eq", field, value);
        },
        gt: (field: string, value: string) => {
          filters.push(
            (row) =>
              typeof row[field] === "string" && String(row[field]) > value,
          );
          return record("gt", field, value);
        },
        order: (field: string, options: unknown) => {
          orders.push(field);
          return record("order", field, options);
        },
        range: async (from: number, to: number) => {
          record("range", from, to);
          const rows = state.rows
            .filter((row) => filters.every((filter) => filter(row)))
            .sort((a, b) => {
              for (const field of orders) {
                const difference = String(a[field]).localeCompare(
                  String(b[field]),
                );
                if (difference) return difference;
              }
              return 0;
            });
          return {
            data: rows.slice(from, to + 1),
            count: rows.length,
            error: state.error ? { message: "Database unavailable" } : null,
          };
        },
      };
      return query;
    },
  }),
}));

import AdminActivationsPage from "@/app/(admin)/admin/(console)/activations/page";

function reservation(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status: "reserved",
    record_origin: "portal",
    payout_basis: "projected",
    principal_ugx: 250000,
    is_test: false,
    requested_at: "2026-10-01T12:00:00Z",
    maturity_date: "2027-03-31",
    reservation_expires_at: "2099-10-04T12:00:00Z",
    profiles: { legal_name: `Partner ${id}`, email: "partner@example.test" },
    investment_cycles: { name: "Cycle One" },
    ...overrides,
  };
}

beforeEach(() => {
  state.rows = [];
  state.calls = [];
  state.error = false;
  state.requireAdmin.mockReset().mockResolvedValue({ id: "admin-1" });
});

describe("admin activation queue", () => {
  it("shows only unpaid, unexpired portal reservations and prioritizes expiry", async () => {
    state.rows = [
      reservation("later"),
      reservation("sooner", { reservation_expires_at: "2099-10-03T12:00:00Z" }),
      reservation("expired", {
        reservation_expires_at: "2000-01-01T12:00:00Z",
      }),
      reservation("active", { status: "active" }),
      reservation("matured", { status: "matured" }),
      reservation("cancelled", { status: "cancelled" }),
      reservation("imported", { record_origin: "legacy_import" }),
      reservation("paid", { payout_basis: "reported_paid" }),
      reservation("no-expiry", { reservation_expires_at: null }),
    ];
    const html = renderToStaticMarkup(
      await AdminActivationsPage({ searchParams: Promise.resolve({}) }),
    );
    expect(state.requireAdmin).toHaveBeenCalledOnce();
    expect(html).toContain('data-investment="sooner"');
    expect(html).toContain('value="250000"');
    expect(html.indexOf('data-investment="sooner"')).toBeLessThan(
      html.indexOf('data-investment="later"'),
    );
    expect(html.match(/data-investment=/g)).toHaveLength(2);
    expect(html).toContain("of 2 reservations awaiting activation");
  });

  it("paginates the pending queue without silently truncating it", async () => {
    state.rows = Array.from({ length: 30 }, (_, i) =>
      reservation(`reservation-${String(i).padStart(2, "0")}`),
    );
    const html = renderToStaticMarkup(
      await AdminActivationsPage({
        searchParams: Promise.resolve({ page: "2" }),
      }),
    );
    expect(state.calls).toContainEqual({ method: "range", args: [25, 49] });
    expect(html.match(/data-investment=/g)).toHaveLength(5);
    expect(html).toContain("Showing 26–30 of 30");
    expect(html).toContain("/admin/activations?page=1");
  });

  it("shows an empty queue and falls back from invalid page input", async () => {
    const html = renderToStaticMarkup(
      await AdminActivationsPage({
        searchParams: Promise.resolve({ page: "-2" }),
      }),
    );
    expect(html).toContain("No investments awaiting activation");
    expect(state.calls).toContainEqual({ method: "range", args: [0, 24] });
  });

  it("reports query failures rather than presenting an empty queue", async () => {
    state.error = true;
    await expect(
      AdminActivationsPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("Unable to load investments awaiting activation");
  });

  it("requires admin authorization before querying investments", async () => {
    state.requireAdmin.mockRejectedValueOnce(new Error("Admin required"));
    await expect(
      AdminActivationsPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("Admin required");
    expect(state.calls).toHaveLength(0);
  });
});
