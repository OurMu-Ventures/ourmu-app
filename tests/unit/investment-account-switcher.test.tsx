// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const navigation = vi.hoisted(() => ({
  path: "/dashboard",
  query: "",
  push: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.path,
  useSearchParams: () => new URLSearchParams(navigation.query),
  useRouter: () => ({ push: navigation.push }),
}));
vi.mock("@/actions/investment-accounts", () => ({
  saveInvestmentAccount: vi.fn(),
  moveInvestmentAccount: vi.fn(),
}));
import {
  InvestmentAccountSwitcher,
  MoveInvestmentForm,
} from "@/components/InvestmentAccounts";
const accounts = [
  { id: "main", name: "Main Account", is_default: true, archived_at: null },
  { id: "school", name: "School Fees", is_default: false, archived_at: null },
];
beforeEach(() => {
  navigation.path = "/dashboard";
  navigation.query = "";
  navigation.push.mockClear();
});
afterEach(cleanup);
describe("account switching", () => {
  it("starts on All accounts and switches the overview using an explicit URL", () => {
    render(<InvestmentAccountSwitcher accounts={accounts} />);
    expect(screen.getByLabelText("Investment account")).toHaveValue("all");
    fireEvent.change(screen.getByLabelText("Investment account"), {
      target: { value: "school" },
    });
    expect(navigation.push).toHaveBeenCalledWith("/dashboard?account=school");
  });
  it("retains the investment list when switching to All accounts", () => {
    navigation.path = "/investments";
    navigation.query = "account=school";
    render(<InvestmentAccountSwitcher accounts={accounts} />);
    fireEvent.change(screen.getByLabelText("Investment account"), {
      target: { value: "all" },
    });
    expect(navigation.push).toHaveBeenCalledWith("/investments?account=all");
  });
  it("shows the investment's actual account even if a link has another account in its query", () => {
    navigation.path = "/investments/placement";
    navigation.query = "account=main";
    render(
      <InvestmentAccountSwitcher accounts={accounts} accountId="school" />,
    );
    expect(screen.getByLabelText("Investment account")).toHaveValue("school");
    fireEvent.change(screen.getByLabelText("Investment account"), {
      target: { value: "main" },
    });
    expect(navigation.push).toHaveBeenCalledWith("/dashboard?account=main");
  });
});

describe("moving an investment", () => {
  const destinations = [
    { id: "school", name: "School Fees" },
    { id: "retirement", name: "Retirement" },
  ];
  it("starts a fresh confirmation after the investment moves to another account", () => {
    const { rerender } = render(
      <MoveInvestmentForm investmentId="placement" from={accounts[0]} destinations={destinations} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Move investment" }));
    const firstRequest = new FormData(screen.getByRole("button", { name: "Confirm move" }).closest("form")!).get("requestId");

    // The server action redirects to this same page with the updated account.
    rerender(
      <MoveInvestmentForm investmentId="placement" from={accounts[1]} destinations={[accounts[0], destinations[1]]} />,
    );
    expect(screen.getByLabelText("Move to")).not.toBeDisabled();
    expect(screen.getByLabelText("Move to")).toHaveValue("main");
    expect(screen.queryByRole("button", { name: "Confirm move" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Move investment" }));
    expect(screen.getByRole("group", { name: "Confirm move" })).toHaveTextContent("from School Fees to Main Account");
    const secondData = new FormData(screen.getByRole("button", { name: "Confirm move" }).closest("form")!);
    expect(secondData.get("fromAccountId")).toBe("school");
    expect(secondData.get("toAccountId")).toBe("main");
    expect(secondData.get("requestId")).not.toBe(firstRequest);
  });
  it("asks for confirmation naming both accounts before submitting", () => {
    render(
      <MoveInvestmentForm
        investmentId="placement"
        from={accounts[0]}
        destinations={destinations}
      />,
    );
    expect(screen.queryByRole("button", { name: "Confirm move" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Move to"), {
      target: { value: "retirement" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Move investment" }));
    expect(screen.getByRole("group", { name: "Confirm move" })).toHaveTextContent(
      "from Main Account to Retirement",
    );
    const form = screen.getByRole("button", { name: "Confirm move" }).closest("form")!;
    const data = new FormData(form);
    expect(data.get("toAccountId")).toBe("retirement");
    expect(data.get("fromAccountId")).toBe("main");
    expect(String(data.get("requestId"))).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("lets the partner back out and choose again", () => {
    render(
      <MoveInvestmentForm
        investmentId="placement"
        from={accounts[0]}
        destinations={destinations}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Move investment" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Confirm move" })).toBeNull();
    expect(screen.getByLabelText("Move to")).not.toBeDisabled();
  });
});
