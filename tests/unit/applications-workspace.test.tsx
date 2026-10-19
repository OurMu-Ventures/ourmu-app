// @vitest-environment jsdom
import {
  cleanup,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApplicationsWorkspace } from "@/components/ApplicationsWorkspace";
import {
  approveApplication,
  createInvitation,
  reissueInvitation,
  revokeInvitation,
} from "@/actions/applications";
import type { ApplicationCard, InvitationCard } from "@/lib/application-views";
vi.mock("@/actions/applications", () => ({
  approveApplication: vi.fn(),
  rejectApplication: vi.fn(),
  createInvitation: vi.fn(),
  reissueInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
}));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/ui/link-status", () => ({ LinkStatus: () => null }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const applicant: ApplicationCard = {
  id: "a-1",
  legal_name: "Sample Applicant",
  email: "sample@example.com",
  phone: "+256700000000",
  date_of_birth: "1990-01-01",
  address: "Sample address",
  district: "Kampala",
  country: "Uganda",
  created_at: "2026-10-10T10:00:00Z",
  reviewed_at: null,
  status: "submitted",
};
const invitation: InvitationCard = {
  id: "i-1",
  invited_email: "invite@example.com",
  created_at: "2026-10-15T10:00:00Z",
  expires_at: "2026-10-22T10:00:00Z",
  used_at: null,
  revoked_at: null,
};
const base = {
  tab: "review" as const,
  page: 1,
  count: 2,
  pendingCount: 30,
  applications: [
    applicant,
    { ...applicant, id: "a-2", legal_name: "Second Applicant" },
  ],
  invitations: [],
  loadError: false,
  now: Date.parse("2026-10-19T10:00:00Z"),
};

describe("combined applications workspace", () => {
  it("focuses the expanded invite form and retains the email on failure", async () => {
    vi.mocked(createInvitation)
      .mockResolvedValueOnce({ ok: false, message: "Email delivery failed." })
      .mockResolvedValueOnce({ ok: true, message: "Invitation sent." });
    const user = userEvent.setup();
    render(<ApplicationsWorkspace {...base} />);
    expect(screen.queryByLabelText("Email address")).not.toBeVisible();
    await user.click(screen.getByRole("button", { name: "Invite applicant" }));
    const input = screen.getByLabelText("Email address");
    expect(input).toHaveFocus();
    await user.type(input, "invite@example.com");
    await user.click(screen.getByRole("button", { name: "Send invitation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Email delivery failed.",
    );
    expect(input).toHaveValue("invite@example.com");
    await user.click(screen.getByRole("button", { name: "Send invitation" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Invitation sent.",
    );
    expect(input).toHaveValue("");
  });
  it("keeps independent review drafts and retains confirmation after the card disappears", async () => {
    const user = userEvent.setup();
    vi.mocked(approveApplication).mockResolvedValue({
      ok: true,
      message: "Application approved.",
    });
    const view = render(<ApplicationsWorkspace {...base} />);
    const summaries = screen.getAllByText("Review application");
    await user.click(summaries[0]);
    const cards = screen.getAllByRole("article");
    await user.type(
      within(cards[0]).getByLabelText(/Offline verification/),
      "REF-1",
    );
    await user.click(summaries[1]);
    expect(within(cards[0]).getByLabelText(/Offline verification/)).toHaveValue(
      "REF-1",
    );
    await user.click(
      within(cards[0]).getByRole("button", { name: /Approve and send/ }),
    );
    await waitFor(() => expect(approveApplication).toHaveBeenCalledOnce());
    view.rerender(
      <ApplicationsWorkspace
        {...base}
        applications={[base.applications[1]]}
        count={1}
        pendingCount={29}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Sample Applicant: Application approved.",
    );
    expect(
      screen.queryByRole("heading", { name: "Sample Applicant" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Needs review.*29/ }),
    ).toHaveAttribute("aria-current", "page");
  });
  it.each(["reissue", "revoke"] as const)(
    "submits %s and displays invitation feedback",
    async (decision) => {
      const action =
        decision === "reissue" ? reissueInvitation : revokeInvitation;
      vi.mocked(action).mockResolvedValue({
        ok: true,
        message: "Invitation updated.",
      });
      const user = userEvent.setup();
      render(
        <ApplicationsWorkspace
          {...base}
          tab="invitations"
          invitations={[invitation]}
          count={1}
        />,
      );
      await user.click(
        screen.getByRole("button", {
          name: decision === "reissue" ? "Reissue" : "Revoke",
        }),
      );
      expect(await screen.findByRole("status")).toHaveTextContent(
        "invite@example.com: Invitation updated.",
      );
      expect(vi.mocked(action).mock.calls[0][0].get("invitationId")).toBe(
        "i-1",
      );
    },
  );
  it("shows lifecycle statuses with only eligible invitation actions", () => {
    render(
      <ApplicationsWorkspace
        {...base}
        tab="invitations"
        count={4}
        invitations={[
          invitation,
          { ...invitation, id: "expired", expires_at: "2026-10-01T00:00:00Z" },
          { ...invitation, id: "revoked", revoked_at: "2026-10-18T00:00:00Z" },
          { ...invitation, id: "used", used_at: "2026-10-18T00:00:00Z" },
        ]}
      />,
    );
    const cards = screen.getAllByRole("article");
    ["active", "expired", "revoked", "used"].forEach((status, index) =>
      expect(within(cards[index]).getByText(status)).toBeVisible(),
    );
    expect(
      within(cards[2]).queryByRole("button", { name: "Revoke" }),
    ).toBeNull();
    expect(within(cards[3]).queryByRole("button")).toBeNull();
  });
  it("keeps history read-only and view links reset pagination", () => {
    render(
      <ApplicationsWorkspace
        {...base}
        tab="history"
        page={2}
        count={26}
        applications={[
          {
            ...applicant,
            status: "approved",
            reviewed_at: "2026-10-18T00:00:00Z",
          },
        ]}
      />,
    );
    expect(screen.getByText(/Decision recorded/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Needs review/ })).toHaveAttribute(
      "href",
      "/admin/applications?tab=review",
    );
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute(
      "href",
      "/admin/applications?tab=history",
    );
    expect(screen.queryByRole("link", { name: "Next" })).toBeNull();
  });
  it("distinguishes an empty view from a failed query", async () => {
    const user = userEvent.setup();
    const view = render(
      <ApplicationsWorkspace {...base} count={0} applications={[]} />,
    );
    expect(screen.getByText(/No applications need review/)).toBeVisible();
    view.rerender(
      <ApplicationsWorkspace {...base} loadError pendingCount={null} />,
    );
    expect(screen.queryByText(/No applications need review/)).toBeNull();
    expect(screen.queryByRole("article")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(refresh).toHaveBeenCalledOnce();
  });
});
