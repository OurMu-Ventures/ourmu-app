import { describe, expect, it } from "vitest";

import { renderTransactionalEmail } from "@/lib/email/template";

describe("transactional email rendering", () => {
  it("matches the Supabase magic-link subject and body for aliases", () => {
    const email = renderTransactionalEmail({
      template: "magic_link",
      actionUrl: "https://partners.ourmu.org/auth/confirm?token_hash=secret",
    });

    expect(email).toEqual({
      subject: "Your sign-in link",
      html: '<h2>Your sign-in link</h2><p>Follow the link below to sign in. This link expires one hour after it was requested and works once.</p><p><a href="https://partners.ourmu.org/auth/confirm?token_hash=secret">Sign in</a></p>',
    });
  });

  it("renders maturity notices with actionable subjects", () => {
    const notice = renderTransactionalEmail({
      template: "maturity_notice",
      actionUrl: "https://example.com/investments/123",
    });
    const fulfilled = renderTransactionalEmail({
      template: "maturity_fulfilled",
    });

    expect(notice.subject).toContain("matured");
    expect(notice.html).toContain("Continue securely");
    expect(fulfilled.subject).toContain("fulfilled");
  });

  it("escapes magic-link URLs without changing other templates", () => {
    const magicLink = renderTransactionalEmail({
      template: "magic_link",
      actionUrl: 'https://example.com/?next="unsafe"&value=<tag>',
    });
    const verification = renderTransactionalEmail({
      template: "account_email_verification",
      actionUrl: "https://example.com/verify",
    });

    expect(magicLink.html).toContain(
      'href="https://example.com/?next=&quot;unsafe&quot;&amp;value=&lt;tag&gt;"',
    );
    expect(verification.subject).toBe("Verify your additional OURMU email");
    expect(verification.html).toContain("Continue securely");
  });
});
