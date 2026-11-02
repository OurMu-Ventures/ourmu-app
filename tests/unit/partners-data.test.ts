import { beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  fetchAllRows,
  loadPartnerListings,
  loadPortfolioInvestments,
  partnerInvestmentFilter,
  resolvePartner,
} from "@/lib/partners";

type Row = Record<string, unknown> & { id: string };

const PROFILE = "5a1c7f9e-2b4d-4e6f-8a0b-1c2d3e4f5a6b";
const OTHER_PROFILE = "6b2d8a0f-3c5e-4f70-9b1c-2d3e4f5a6b7c";
const ADMIN = "7c3e9b1a-4d6f-4081-8c2d-3e4f5a6b7c8d";
const CLAIMED = "73a1f123-cdb8-5359-9075-f36604131850";
const UNCLAIMED = "84b2a234-dec9-546a-a186-a47715242961";
const STAGED = "95c3b345-efda-557b-b297-b58826353a72";

const db: Record<string, Row[]> = {};
let maxRows = 1000;
const calls: { table: string; method: string; args: unknown[] }[] = [];

// Splits a PostgREST or() expression on top-level commas.
function orFilter(expression: string) {
  const parts = expression.match(/[^,(]+(?:\([^)]*\))?/g) ?? [];
  const tests = parts.map((part) => {
    const [column, operator, ...rest] = part.split(".");
    const value = rest.join(".");
    return operator === "in"
      ? (row: Row) =>
          value.slice(1, -1).split(",").includes(String(row[column]))
      : (row: Row) => row[column] === value;
  });
  return (row: Row) => tests.some((test) => test(row));
}

function client() {
  return {
    from(table: string) {
      const filters: ((row: Row) => boolean)[] = [];
      let order: string | null = null;
      let counted = false;
      const record = (method: string, ...args: unknown[]) =>
        calls.push({ table, method, args });
      const rows = () => {
        const matched = (db[table] ?? []).filter((row) =>
          filters.every((filter) => filter(row)),
        );
        return order
          ? [...matched].sort((a, b) =>
              String(a[order!]).localeCompare(String(b[order!])),
            )
          : matched;
      };
      const builder = {
        select(...args: unknown[]) {
          record("select", ...args);
          counted =
            (args[1] as { count?: string } | undefined)?.count === "exact";
          return builder;
        },
        eq(column: string, value: unknown) {
          record("eq", column, value);
          filters.push((row) => row[column] === value);
          return builder;
        },
        or(expression: string) {
          record("or", expression);
          filters.push(orFilter(expression));
          return builder;
        },
        order(column: string) {
          order = column;
          return builder;
        },
        range(from: number, to: number) {
          record("range", from, to);
          const all = rows();
          return Promise.resolve({
            data: all.slice(from, Math.min(to + 1, from + maxRows)),
            error: null,
            count: counted ? all.length : null,
          });
        },
        maybeSingle() {
          return Promise.resolve({ data: rows()[0] ?? null, error: null });
        },
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve({ data: rows(), error: null }).then(resolve);
        },
      };
      return builder;
    },
  } as never;
}

function investment(overrides: Partial<Row> = {}): Row {
  return {
    id: crypto.randomUUID(),
    investor_id: null,
    legacy_partner_id: null,
    status: "active",
    ...overrides,
  };
}

beforeEach(() => {
  maxRows = 1000;
  calls.length = 0;
  db.profiles = [
    {
      id: PROFILE,
      role: "investor",
      legal_name: "Jane Doe",
      email: "jane@example.test",
      access_status: "active",
      kyc_status: "verified",
      is_test: false,
    },
    {
      id: OTHER_PROFILE,
      role: "investor",
      legal_name: "Ann Example",
      email: "ann@example.test",
      access_status: "disabled",
      kyc_status: "pending",
      is_test: true,
    },
    {
      id: ADMIN,
      role: "admin",
      legal_name: "Admin Person",
      email: "admin@example.test",
      access_status: "active",
      kyc_status: "verified",
      is_test: false,
    },
  ];
  db.account_emails = [
    {
      id: "e2",
      user_id: PROFILE,
      email: "pending@example.test",
      is_primary: false,
      verified_at: null,
      created_at: "2026-10-02T00:00:00Z",
    },
    {
      id: "e1",
      user_id: PROFILE,
      email: "work@example.test",
      is_primary: false,
      verified_at: "2026-10-01T00:00:00Z",
      created_at: "2026-10-01T00:00:00Z",
    },
  ];
  db.legacy_partner_identities = [
    {
      id: CLAIMED,
      canonical_name: "J. Doe",
      normalized_email: "jane@example.test",
      normalized_phone: null,
      source_aliases: ["Jane D.", "J. Doe"],
      profile_id: PROFILE,
      import_batches: { status: "accepted" },
    },
    {
      id: UNCLAIMED,
      canonical_name: "Jane Doe",
      normalized_email: null,
      normalized_phone: "+256 700 000 123",
      source_aliases: [],
      profile_id: null,
      import_batches: { status: "accepted" },
    },
    {
      id: STAGED,
      canonical_name: "Bob Staged",
      normalized_email: null,
      normalized_phone: null,
      source_aliases: [],
      profile_id: null,
      import_batches: { status: "staged" },
    },
  ];
  db.investments = [];
});

describe("bounded batch reads", () => {
  it("keeps reading past a lower server row limit until the exact count is reached", async () => {
    maxRows = 200;
    db.investments = Array.from({ length: 1_203 }, () =>
      investment({ investor_id: PROFILE }),
    );
    const rows = await loadPortfolioInvestments(client(), {
      kind: "profile",
      ref: { kind: "profile", id: PROFILE },
      name: "Jane Doe",
      email: "jane@example.test",
      accessStatus: "active",
      kycStatus: "verified",
      isTest: false,
      additionalEmails: [],
      linkedIdentities: [],
    });
    expect(rows).toHaveLength(1_203);
    expect(new Set(rows.map((row) => row.id)).size).toBe(1_203);
    expect(
      calls
        .filter((call) => call.method === "range")
        .map((call) => call.args[0]),
    ).toEqual([0, 200, 400, 600, 800, 1000, 1200]);
  });

  it("counts a row once when pages shift between batches", async () => {
    const ids = Array.from({ length: 600 }, (_, index) => ({
      id: String(index).padStart(4, "0"),
    }));
    const pages = [ids.slice(0, 500), ids.slice(499, 600)];
    const rows = await fetchAllRows(() =>
      Promise.resolve({ data: pages.shift() ?? [], error: null, count: 600 }),
    );
    expect(rows).toHaveLength(600);
  });

  it("fails loudly rather than truncating on errors or oversized results", async () => {
    await expect(
      fetchAllRows(() =>
        Promise.resolve({
          data: null,
          error: { message: "boom" },
          count: null,
        }),
      ),
    ).rejects.toThrow("Unable to load partner records");
    let next = 0;
    await expect(
      fetchAllRows(() =>
        Promise.resolve({
          data: Array.from({ length: 500 }, () => ({ id: String(next++) })),
          error: null,
          count: 1_000_000,
        }),
      ),
    ).rejects.toThrow("exceed the supported size");
  });
});

describe("partner directory", () => {
  it("lists investor profiles and unclaimed identities, folding claimed identities into their profile", async () => {
    const listings = await loadPartnerListings(client());
    expect(listings.map((item) => [item.ref.kind, item.name])).toEqual([
      ["profile", "Ann Example"],
      ["legacy", "Bob Staged"],
      ["profile", "Jane Doe"],
      ["legacy", "Jane Doe"],
    ]);
    const jane = listings[2];
    expect(jane).toMatchObject({
      ref: { kind: "profile", id: PROFILE },
      email: "jane@example.test",
      importedNames: ["J. Doe", "Jane D."],
      additionalEmails: [
        { email: "work@example.test", verified: true },
        { email: "pending@example.test", verified: false },
      ],
    });
    expect(listings[3]).toMatchObject({
      ref: { kind: "legacy", id: UNCLAIMED },
      email: null,
      phoneHint: "•••• 0123",
      importAccepted: true,
    });
    expect(listings[1].importAccepted).toBe(false);
    expect(listings.some((item) => item.ref.id === CLAIMED)).toBe(false);
    expect(listings.some((item) => item.ref.id === ADMIN)).toBe(false);
  });
});

describe("partner resolution", () => {
  it("resolves a profile with its linked identities and additional emails", async () => {
    const result = await resolvePartner(client(), {
      kind: "profile",
      id: PROFILE,
    });
    expect(result).toMatchObject({
      status: "found",
      partner: {
        kind: "profile",
        name: "Jane Doe",
        linkedIdentities: [{ id: CLAIMED, name: "J. Doe" }],
      },
    });
  });

  it("does not resolve administrators or unknown partners", async () => {
    expect(
      await resolvePartner(client(), { kind: "profile", id: ADMIN }),
    ).toEqual({ status: "missing" });
    expect(
      await resolvePartner(client(), {
        kind: "legacy",
        id: "00000000-0000-4000-8000-000000000000",
      }),
    ).toEqual({ status: "missing" });
  });

  it("keeps unclaimed identities viewable and sends claimed ones to their profile", async () => {
    expect(
      await resolvePartner(client(), { kind: "legacy", id: UNCLAIMED }),
    ).toMatchObject({
      status: "found",
      partner: { kind: "legacy", name: "Jane Doe", importAccepted: true },
    });
    expect(
      await resolvePartner(client(), { kind: "legacy", id: CLAIMED }),
    ).toEqual({ status: "claimed", profile: { kind: "profile", id: PROFILE } });
  });
});

describe("portfolio records", () => {
  it("combines profile-owned and linked imported records, counting each once", async () => {
    const both = investment({
      investor_id: PROFILE,
      legacy_partner_id: CLAIMED,
    });
    const portal = investment({ investor_id: PROFILE });
    const importedOnly = investment({ legacy_partner_id: CLAIMED });
    const unclaimed = investment({ legacy_partner_id: UNCLAIMED });
    const someoneElse = investment({ investor_id: OTHER_PROFILE });
    db.investments = [both, portal, importedOnly, unclaimed, someoneElse];
    const resolved = await resolvePartner(client(), {
      kind: "profile",
      id: PROFILE,
    });
    if (resolved.status !== "found") throw new Error("expected a partner");
    expect(partnerInvestmentFilter(resolved.partner)).toBe(
      `investor_id.eq.${PROFILE},legacy_partner_id.in.(${CLAIMED})`,
    );
    const rows = await loadPortfolioInvestments(client(), resolved.partner);
    expect(rows.map((row) => row.id).sort()).toEqual(
      [both.id, portal.id, importedOnly.id].sort(),
    );
  });

  it("loads only an unclaimed identity's own records", async () => {
    const own = investment({ legacy_partner_id: UNCLAIMED });
    db.investments = [own, investment({ legacy_partner_id: CLAIMED })];
    const resolved = await resolvePartner(client(), {
      kind: "legacy",
      id: UNCLAIMED,
    });
    if (resolved.status !== "found") throw new Error("expected a partner");
    expect(partnerInvestmentFilter(resolved.partner)).toBe(
      `legacy_partner_id.eq.${UNCLAIMED}`,
    );
    expect(
      (await loadPortfolioInvestments(client(), resolved.partner)).map(
        (row) => row.id,
      ),
    ).toEqual([own.id]);
  });

  it("filters a profile without linked identities by owner only", async () => {
    const resolved = await resolvePartner(client(), {
      kind: "profile",
      id: OTHER_PROFILE,
    });
    if (resolved.status !== "found") throw new Error("expected a partner");
    expect(partnerInvestmentFilter(resolved.partner)).toBe(
      `investor_id.eq.${OTHER_PROFILE}`,
    );
  });
});
