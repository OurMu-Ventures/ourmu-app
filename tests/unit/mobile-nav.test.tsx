// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ShellNav, type ShellLink } from "@/components/ShellNav";

vi.mock("next/navigation", () => ({ usePathname: () => "/investments" }));
vi.mock("@/components/ui/link-status", () => ({
  LinkStatus: () => null,
}));

const links: ShellLink[] = [
  { href: "/dashboard", label: "Overview", status: "Opening overview" },
  { href: "/investments", label: "Investments", status: "Opening investments" },
];

function renderNav() {
  render(<ShellNav links={links} label="Investor portal" />);
  return {
    toggle: screen.getByRole("button", { name: "Open navigation" }),
    nav: screen.getByRole("navigation", { name: "Investor portal" }),
  };
}

beforeEach(() => {
  document.body.style.overflow = "";
});

afterEach(() => {
  cleanup();
});

describe("ShellNav", () => {
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

  it("closes when a link is tapped", async () => {
    const user = userEvent.setup();
    const { nav } = renderNav();
    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(nav.className).toMatch(/open/);

    await user.click(screen.getByRole("link", { name: "Overview" }));

    expect(nav.className).not.toMatch(/open/);
  });
});
