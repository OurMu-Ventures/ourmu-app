// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/forms", () => ({
  MagicLinkForm: ({ submitLabel }: { submitLabel?: string }) => (
    <div data-testid="magic-link-form">{submitLabel ?? "Email me a secure link"}</div>
  ),
}));

import { AuthStartClient } from "@/components/AuthStartClient";

function setHash(hash: string) {
  window.history.replaceState(null, "", "/auth/start");
  window.location.hash = hash;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://xyz.supabase.co";
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AuthStartClient", () => {
  it("loading the page alone never redeems the link", async () => {
    setHash("#token_hash=fresh-token&type=magiclink&next=%2Fdashboard");
    render(<AuthStartClient />);

    expect(
      await screen.findByRole("button", { name: /continue securely/i }),
    ).toBeVisible();
    // No network redemption happens until the deliberate continuation.
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("deliberate Continue POSTs the token same-origin and follows the redirect", async () => {
    setHash("#token_hash=fresh-token&type=magiclink&next=%2Fdashboard");
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true, redirectTo: "/dashboard" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    render(<AuthStartClient />);

    await user.click(
      await screen.findByRole("button", { name: /continue securely/i }),
    );

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1));
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/auth/confirm");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.token_hash).toBe("fresh-token");
    // The token travels in the POST body, never in the request URL.
    expect(url).not.toContain("fresh-token");
  });

  it("a consumed or missing link shows recovery with a fresh-link form", async () => {
    setHash("");
    render(<AuthStartClient />);

    expect(
      await screen.findByText(/already been used or has expired/i),
    ).toBeVisible();
    expect(await screen.findByTestId("magic-link-form")).toHaveTextContent(
      "Email me a fresh link",
    );
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});
