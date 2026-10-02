// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/AppShell";
import { ShellNav, type ShellLink } from "@/components/ShellNav";

const route = vi.hoisted(() => ({ pathname: "/investments", query: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useSearchParams: () => new URLSearchParams(route.query),
}));
vi.mock("@/components/ui/link-status", () => ({
  LinkStatus: () => null,
}));
vi.mock("@/actions/auth", () => ({ signOut: vi.fn() }));

const links: ShellLink[] = [
  { href: "/dashboard", label: "Overview", status: "Opening overview" },
  { href: "/investments", label: "Investments", status: "Opening investments" },
];

function renderNav() {
  render(<ShellNav links={links} label="Partner portal" />);
  return {
    toggle: screen.getByRole("button", { name: "Open navigation" }),
    nav: screen.getByRole("navigation", { name: "Partner portal" }),
  };
}

beforeEach(() => {
  document.body.style.overflow = "";
  route.pathname = "/investments";
  route.query = "";
});

afterEach(() => {
  cleanup();
});

describe("ShellNav", () => {
  it("places Activations directly after admin overview and keeps it out of partner navigation", () => {
    const { unmount } = render(<AppShell admin>Admin content</AppShell>);
    const adminLinks = screen.getAllByRole("link");
    expect(adminLinks[0]).toHaveTextContent("Admin overview");
    expect(adminLinks[1]).toHaveTextContent("Activations");
    expect(adminLinks[1]).toHaveAttribute("href", "/admin/activations");
    expect(adminLinks[2]).toHaveAttribute("href", "/admin/maturities?tab=withdrawals");
    unmount();
    render(<AppShell>Partner content</AppShell>);
    expect(screen.queryByRole("link", { name: "Activations" })).not.toBeInTheDocument();
  });

  it.each(["withdrawals", "reinvestments", "history"])("highlights one admin sidebar entry for %s", (tab) => {
    route.pathname = "/admin/maturities";
    route.query = `tab=${tab}&page=2`;
    render(<AppShell admin>Admin content</AppShell>);
    const active = screen.getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page");
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveTextContent(tab === "withdrawals" ? "Withdrawals" : "Maturities");
  });

  it.each(["", "tab=unknown"])("highlights Withdrawals for default tab query %s", (query) => {
    route.pathname = "/admin/maturities";
    route.query = query;
    render(<AppShell admin>Admin content</AppShell>);
    expect(screen.getByRole("link", { name: "Withdrawals" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Maturities" })).not.toHaveAttribute("aria-current");
  });

  it("uses the base section for nested maturity routes", () => {
    route.pathname = "/admin/maturities/instruction";
    render(<AppShell admin>Admin content</AppShell>);
    expect(screen.getByRole("link", { name: "Maturities" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Withdrawals" })).not.toHaveAttribute("aria-current");
  });

  it("marks the current page and labels the section bar", () => {
    renderNav();
    expect(screen.getByRole("link", { name: "Investments" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(document.querySelector(".shell-bar-current")?.textContent).toBe(
      "Investments",
    );
  });

  it("opens the drawer on toggle and focuses the panel", async () => {
    const user = userEvent.setup();
    const { toggle, nav } = renderNav();
    expect(nav.className).not.toMatch(/open/);

    await user.click(toggle);

    expect(nav.className).toMatch(/open/);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(document.activeElement).toBe(nav);
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("closes on Escape and returns focus to the toggle", async () => {
    const user = userEvent.setup();
    const { toggle, nav } = renderNav();
    await user.click(toggle);

    await user.keyboard("{Escape}");

    expect(nav.className).not.toMatch(/open/);
    expect(document.activeElement).toBe(toggle);
    expect(document.body.style.overflow).toBe("");
  });

  it("keeps the drawer open during navigation so the loading indicator stays visible", async () => {
    const user = userEvent.setup();
    const { nav } = renderNav();
    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(nav.className).toMatch(/open/);

    await user.click(screen.getByRole("link", { name: "Overview" }));

    expect(nav.className).toMatch(/open/);
  });

  it("closes when the current-page link is tapped", async () => {
    const user = userEvent.setup();
    const { nav } = renderNav();
    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(nav.className).toMatch(/open/);

    await user.click(screen.getByRole("link", { name: "Investments" }));

    expect(nav.className).not.toMatch(/open/);
  });

  it("offers sign out inside the drawer", async () => {
    const user = userEvent.setup();
    renderNav();
    await user.click(screen.getByRole("button", { name: "Open navigation" }));

    expect(
      screen.getByRole("button", { name: "Sign out" }),
    ).toBeInTheDocument();
  });
});
