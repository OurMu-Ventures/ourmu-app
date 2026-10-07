import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getNewsletterContactEmail } from "@/lib/env";

afterEach(() => vi.unstubAllEnvs());

describe("newsletter contact configuration", () => {
  it("uses a configured server-side inbox", () => {
    vi.stubEnv("NEWSLETTER_CONTACT_EMAIL", "partner-support@example.com");
    expect(getNewsletterContactEmail()).toBe("partner-support@example.com");
  });

  it("falls back to the general inbox when unset", () => {
    vi.stubEnv("NEWSLETTER_CONTACT_EMAIL", undefined);
    expect(getNewsletterContactEmail()).toBe("community@ourmu.org");
  });

  it("rejects malformed inboxes instead of building an unsafe mailto link", () => {
    vi.stubEnv("NEWSLETTER_CONTACT_EMAIL", "hello@example.com?bcc=other@example.com");
    expect(getNewsletterContactEmail()).toBe("community@ourmu.org");
  });
});
