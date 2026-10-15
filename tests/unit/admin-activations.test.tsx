// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  requireAdmin: vi.fn(async () => ({ id: "admin-1" })),
  rows: [] as Array<Record<string, unknown>>,
  error: false,
  confirmationError: false,
  calls: [] as Array<{ method: string; args: unknown[] }>,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ requireAdmin: state.requireAdmin }));
vi.mock("@/components/forms", () => ({
  ExpireReservationForm: () => <button>Expire reservation</button>,
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
        in: (field: string, values: unknown[]) => {
          filters.push((row) => values.includes(row[field]));
          return record("in", field, values);
        },
        not: (field: string, operator: string, value: unknown) => {
          if (operator === "is" && value === null)
            filters.push((row) => row[field] !== null);
          return record("not", field, operator, value);
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
        maybeSingle: async () => ({
          data:
            state.rows.find((row) => filters.every((filter) => filter(row))) ??
            null,
          error: state.confirmationError ? { message: "Unavailable" } : null,
        }),
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
    activated_at: "2026-10-15T13:59:00Z",
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

afterEach(() => vi.restoreAllMocks());

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-15T14:00:00Z"));
  state.rows = [];
  state.calls = [];
  state.error = false;
  state.confirmationError = false;
  state.requireAdmin.mockReset().mockResolvedValue({ id: "admin-1" });
});

describe("admin activation queue", () => {
  it("shows pending reservations without an expiry and excludes terminal records", async () => {
    state.rows = [
      reservation("later"),
      reservation("sooner", { reservation_expires_at: "2099-10-03T12:00:00Z" }),
      reservation("past-due-reserved", {
        reservation_expires_at: "2000-01-01T12:00:00Z",
      }),
      reservation("marked-expired", {
        status: "expired",
        reservation_expires_at: "2000-01-02T12:00:00Z",
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
    expect(html).toContain("No automatic expiry");
    expect(html).toContain("Expire reservation");
    expect(html).not.toContain('data-investment="marked-expired"');
    expect(html).not.toContain('data-investment="cancelled"');
    expect(html).toContain('data-investment="no-expiry"');
    expect(html.match(/data-investment=/g)).toHaveLength(4);
    expect(html).toContain("of 4 reservations awaiting activation");
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

describe("activation success confirmation", () => {
  const activatedId = "aaea827d-83cf-407a-a3f4-8a7e91af181f";
  it("shows the activated partner and amount even after its card leaves the pending queue", async () => {
    state.rows = [
      reservation(activatedId, { status: "active", principal_ugx: 1250000 }),
    ];
    const html = renderToStaticMarkup(
      await AdminActivationsPage({
        searchParams: Promise.resolve({ activated: activatedId }),
      }),
    );
    expect(html).toContain("Investment activated successfully.");
    expect(html).toContain(`Partner ${activatedId}`);
    expect(html).toContain("1,250,000");
    expect(html).toContain("Cycle One");
    expect(html).toContain('id="activation-success"');
    expect(html).toContain('role="status"');
    expect(html).toContain("View investments");
    expect(html).toContain("No investments awaiting activation.");
    expect(html).not.toContain("data-investment=");
  });
  it("does not claim success for a reservation still pending", async () => {
    state.rows = [reservation(activatedId)];
    const html = renderToStaticMarkup(
      await AdminActivationsPage({
        searchParams: Promise.resolve({ activated: activatedId }),
      }),
    );
    expect(html).not.toContain("Investment activated successfully.");
    expect(html).toContain("Activation status could not be confirmed");
  });
  it("does not claim success when confirmation cannot be loaded", async () => {
    state.rows = [reservation(activatedId, { status: "active" })];
    state.confirmationError = true;
    const html = renderToStaticMarkup(
      await AdminActivationsPage({
        searchParams: Promise.resolve({ activated: activatedId }),
      }),
    );
    expect(html).not.toContain("Investment activated successfully.");
    expect(html).toContain("Check Investments before trying again.");
  });
  it("ignores invalid activation identifiers", async () => {
    const html = renderToStaticMarkup(
      await AdminActivationsPage({
        searchParams: Promise.resolve({ activated: "untrusted" }),
      }),
    );
    expect(html).not.toContain("Investment activated successfully.");
    expect(
      state.calls.some((call) => call.method === "eq" && call.args[0] === "id"),
    ).toBe(false);
  });
});

describe("activation confirmation freshness", () => {
  const id = "aaea827d-83cf-407a-a3f4-8a7e91af181f";
  it.each([
    null,
    "not-a-date",
    "2026-10-15T14:01:00Z",
    "2026-10-15T13:54:59Z",
    "2026-01-01T00:00:00Z",
  ])(
    "does not show success for stale or invalid activated_at %s",
    async (activated_at) => {
      state.rows = [reservation(id, { status: "active", activated_at })];
      const html = renderToStaticMarkup(
        await AdminActivationsPage({
          searchParams: Promise.resolve({ activated: id }),
        }),
      );
      expect(html).not.toContain("Investment activated successfully.");
      expect(html).not.toContain("Activation status could not be confirmed");
    },
  );
  it("includes the five-minute boundary", async () => {
    state.rows = [
      reservation(id, {
        status: "active",
        activated_at: "2026-10-15T13:55:00Z",
      }),
    ];
    const html = renderToStaticMarkup(
      await AdminActivationsPage({
        searchParams: Promise.resolve({ activated: id }),
      }),
    );
    expect(html).toContain("Investment activated successfully.");
  });
});
