// @vitest-environment jsdom
// Element-tree walking needs no DOM, but the ShellNav import chain only
// resolves outside the node environment, like the other component tests.
import type { ReactElement, ReactNode } from "react";
import Link from "next/link";
import { describe, expect, it, vi } from "vitest";

import AdminConsoleLayout from "@/app/(admin)/admin/(console)/layout";
import AdminRootLayout from "@/app/(admin)/admin/layout";
import AdminMfaPage from "@/app/(admin)/admin/mfa/page";
import { AppShell } from "@/components/AppShell";
import { MfaPanel } from "@/components/MfaPanel";
import { ShellNav } from "@/components/ShellNav";
import { requireAdmin } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ id: "admin-1", role: "admin" })),
  requireInvestor: vi.fn(async () => ({ id: "admin-1", role: "admin" })),
}));

// Cuts the server-only import chain below the shell, as in mobile-nav.
vi.mock("@/actions/auth", () => ({ signOut: vi.fn() }));

// Walk a server-rendered element tree without invoking any component, so
// client hooks never run. Proves structurally which segment can emit
// prefetching admin links.
function walk(node: ReactNode): ReactElement[] {
  const out: ReactElement[] = [];
  const visit = (current: ReactNode): void => {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (
      current !== null &&
      typeof current === "object" &&
      "type" in current &&
      "props" in current
    ) {
      const element = current as ReactElement;
      out.push(element);
      visit(
        (element.props as { children?: ReactNode }).children ?? null,
      );
    }
  };
  visit(node);
  return out;
}

function adminHrefs(elements: ReactElement[]): string[] {
  return elements
    .filter((element) => element.type === Link)
    .map((element) => (element.props as { href?: unknown }).href)
    .filter(
      (href): href is string =>
        typeof href === "string" && href.startsWith("/admin"),
    );
}

describe("admin shell boundary", () => {
  it("renders the AAL1 MFA segment with no shell and no admin links", async () => {
    const page = await AdminMfaPage({
      searchParams: Promise.resolve({ next: "/admin/cycles" }),
    });
    const tree = await AdminRootLayout({ children: page });
    const elements = walk(tree);
    const types = new Set(elements.map((element) => element.type));

    expect(requireAdmin).toHaveBeenCalledWith({ aal2: false });
    // No navigation shell, so AAL1 rendering issues no admin prefetches.
    expect(types.has(AppShell)).toBe(false);
    expect(types.has(ShellNav)).toBe(false);
    expect(adminHrefs(elements)).toEqual([]);
    // The requested destination still flows through real validation.
    const panel = elements.find((element) => element.type === MfaPanel);
    expect(panel?.props).toMatchObject({ target: "/admin/cycles" });
  });

  it("defaults the MFA target safely without a request", async () => {
    const page = await AdminMfaPage({ searchParams: Promise.resolve({}) });
    const panel = walk(page).find((element) => element.type === MfaPanel);
    expect(panel?.props).toMatchObject({ target: "/admin" });
  });

  it("keeps the prefetching shell inside the AAL2 console layout", async () => {
    const tree = await AdminConsoleLayout({ children: "console" });
    const types = new Set(walk(tree).map((element) => element.type));
    expect(types.has(AppShell)).toBe(true);
  });
});
