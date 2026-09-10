// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { InfoHint } from "@/components/InfoHint";

afterEach(() => {
  cleanup();
});

describe("InfoHint", () => {
  it("reveals its explainer on tap and dismisses on Escape", async () => {
    const user = userEvent.setup();
    render(<InfoHint label="About profit" text="Fixed return." />);

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "About profit" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Fixed return.");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
