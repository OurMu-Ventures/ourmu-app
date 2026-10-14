// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renameInvestment } from "@/actions/investments";
import { InvestmentAlias } from "@/components/InvestmentAlias";

vi.mock("@/actions/investments", () => ({ renameInvestment: vi.fn() }));
const rename = vi.mocked(renameInvestment);
afterEach(() => {
  cleanup();
  rename.mockReset();
});

describe("InvestmentAlias", () => {
  const props = {
    investmentId: "00000000-0000-4000-8000-000000000001",
    alias: null,
    defaultTitle: "April 2026 - September 2026",
  };

  it("shows the default, saves an alias with Enter, and restores the default", async () => {
    rename
      .mockResolvedValueOnce({ ok: true, alias: "My first investment" })
      .mockResolvedValueOnce({ ok: true, alias: null });
    const user = userEvent.setup();
    render(<InvestmentAlias {...props} />);
    await user.click(screen.getByRole("button", { name: /Rename investment/ }));
    const input = screen.getByRole("textbox", { name: "Investment name" });
    expect(input).toHaveAttribute("placeholder", props.defaultTitle);
    await user.type(input, "My first investment{Enter}");
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "Rename investment My first investment",
        }),
      ).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: /Rename investment/ }));
    await user.click(screen.getByRole("button", { name: "Use default name" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: `Rename investment ${props.defaultTitle}`,
        }),
      ).toBeInTheDocument(),
    );
    expect(rename).toHaveBeenLastCalledWith({
      investmentId: props.investmentId,
      alias: "",
    });
  });

  it("keeps the draft after a failed save and cancels with Escape", async () => {
    rename.mockResolvedValue({
      ok: false,
      message: "Could not save the name. Try again.",
    });
    const user = userEvent.setup();
    render(<InvestmentAlias {...props} />);
    await user.click(screen.getByRole("button", { name: /Rename investment/ }));
    await user.type(screen.getByRole("textbox"), "Portfolio A{Enter}");
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("textbox")).toHaveValue("Portfolio A");
    await user.keyboard("{Escape}");
    expect(
      screen.getByRole("button", {
        name: `Rename investment ${props.defaultTitle}`,
      }),
    ).toBeInTheDocument();
  });

  it("keeps an unsaved draft on blur and shows pending feedback", async () => {
    let finish!: (result: { ok: true; alias: string }) => void;
    rename.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const user = userEvent.setup();
    render(<><InvestmentAlias {...props} /><button type="button">Outside</button></>);
    await user.click(screen.getByRole("button", { name: /Rename investment/ }));
    await user.type(screen.getByRole("textbox"), "My alias");
    await user.click(screen.getByRole("button", { name: "Outside" }));
    expect(screen.getByRole("textbox")).toHaveValue("My alias");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    finish({ ok: true, alias: "My alias" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Rename investment My alias" })).toBeInTheDocument());
  });
});
