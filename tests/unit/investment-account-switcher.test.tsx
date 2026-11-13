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
}));
import { InvestmentAccountSwitcher } from "@/components/InvestmentAccounts";
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
