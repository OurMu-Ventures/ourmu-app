// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/actions/admin", () => ({}));
vi.mock("@/actions/applications", () => ({}));
vi.mock("@/actions/auth", () => ({}));
vi.mock("@/actions/profile", () => ({}));
vi.mock("@/actions/investments", () => ({ activateInvestment: vi.fn() }));
import { activateInvestment } from "@/actions/investments";
import { ActivationForm } from "@/components/forms";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe("activation form retries", () => {
  it("keeps all payment values and allows correction after server validation fails", async () => {
    vi.mocked(activateInvestment).mockResolvedValue({
      ok: false,
      message: "The payment date is before the reservation date.",
    });
    render(
      <ActivationForm
        investmentId="aaea827d-83cf-407a-a3f4-8a7e91af181f"
        expectedAmount={1250000}
      />,
    );
    expect(document.querySelector('input[type="datetime-local"]')).toBeNull();
    const reference = screen.getByLabelText("Bank reference");
    const amount = screen.getByLabelText("Exact amount received (UGX)");
    const date = screen.getByLabelText(/Payment received date/);
    const confirmation = screen.getByLabelText("Type ACTIVATE");
    fireEvent.change(reference, { target: { value: "REAL-REF-123" } });
    fireEvent.change(amount, { target: { value: "1200000" } });
    fireEvent.change(date, { target: { value: "2026-10-14" } });
    fireEvent.change(confirmation, { target: { value: "ACTIVATE" } });
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Activate investment" })
        .closest("form")!,
    );
    await screen.findByText("The payment date is before the reservation date.");
    expect(reference).toHaveValue("REAL-REF-123");
    expect(amount).toHaveValue(1200000);
    expect(date).toHaveValue("2026-10-14");
    expect(confirmation).toHaveValue("ACTIVATE");
    fireEvent.change(date, { target: { value: "2026-10-15" } });
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Activate investment" })
        .closest("form")!,
    );
    await waitFor(() => expect(activateInvestment).toHaveBeenCalledTimes(2));
    const submitted = vi.mocked(activateInvestment).mock.calls[1][1];
    expect(submitted.get("receivedDate")).toBe("2026-10-15");
    expect(submitted.get("bankReference")).toBe("REAL-REF-123");
  });
});
