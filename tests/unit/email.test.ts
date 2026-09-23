import { describe, expect, it } from "vitest";

import { renderTransactionalEmail } from "@/lib/email/template";
import { maturityNoticeDetail } from "@/lib/maturity";

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
    const figures = {
      principalUgx: 10_000_000,
      projectedReturnUgx: 3_000_000,
      projectedValueUgx: 13_000_000,
      projectedPercent: 30,
      maturityDate: "15 September 2026",
      payoutDate: "15 September 2026",
    };
    const notice = renderTransactionalEmail({
      template: "maturity_notice",
      actionUrl: "https://example.com/investments/123",
      detail: maturityNoticeDetail(figures),
      maturityNotice: figures,
    });
    const fulfilled = renderTransactionalEmail({
      template: "maturity_fulfilled",
    });

    expect(notice.subject).toContain("matured");
    expect(notice.html).toContain("background:#f4f7f6");
    expect(notice.html).toContain("border-radius:16px");
    expect(notice.html).toContain("OURMU VENTURES");
    expect(notice.html).toContain("Hello Partner 👋");
    expect(notice.html).toContain("background:#176b5b");
    expect(notice.html).toContain("Choose your payout plan");
    expect(notice.html).toContain("UGX 10,000,000.00");
    expect(notice.html).toContain("UGX 3,000,000.00");
    expect(notice.html).toContain("UGX 13,000,000.00");
    expect(notice.html).toContain("A. Bijjodolo payout");
    expect(notice.html).toContain("B. Paka Paka payout");
    expect(notice.html).toContain("C. Dobolo Payout");
    expect("text" in notice && notice.text).toContain(
      "https://example.com/investments/123",
    );
    expect(fulfilled.subject).toContain("fulfilled");
  });

  it("subjects the partner-action email as needing action", () => {
    const action = renderTransactionalEmail({
      template: "maturity_action_needed",
    });

    expect(action.subject).toContain("Action needed");
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
