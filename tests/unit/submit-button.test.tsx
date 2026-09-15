// @vitest-environment jsdom
import { useActionState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { SubmitButton } from "@/components/SubmitButton";

function PendingForm() {
  const [, action] = useActionState(
    async () => {
      await new Promise<void>(() => undefined);
      return null;
    },
    null,
  );

  return (
    <form action={action}>
      <SubmitButton pendingLabel="Working…">Save</SubmitButton>
    </form>
  );
}

describe("SubmitButton", () => {
  it("disables itself and announces progress while its form action is pending", async () => {
    const user = userEvent.setup();
    render(<PendingForm />);

    const button = screen.getByRole("button", { name: "Save" });
    await user.click(button);

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveTextContent("Working…");
  });
});
