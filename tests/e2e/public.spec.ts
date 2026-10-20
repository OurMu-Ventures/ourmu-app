import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
test("public landing is responsive and discloses the model", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /aquaculture future/i }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /partner login/i })).toBeVisible();
});
test("login does not offer unrestricted sign-up", async ({ page }) => {
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: /sign in to your portal/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /sign in to test account/i }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /sign up|register|create account/i }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /sign up|register|create account/i }),
  ).toHaveCount(0);
});
test("test account login is isolated on an unlinked route", async ({ page }) => {
  await page.goto("/test");
  await expect(
    page.getByRole("heading", { name: /open the test portal/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /sign in to test account/i }),
  ).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/,
  );
});
test("versioned legal content and compliance gates are visible", async ({
  page,
}) => {
  await page.goto("/terms");
  await expect(page.getByText(/compliance notice/i)).toBeVisible();
  for (const path of ["/privacy", "/risk-disclosure"]) {
    await page.goto(path);
    await expect(page.getByText(/compliance notice/i)).toHaveCount(0);
  }
  await page.goto("/risk-disclosure");
  await expect(page.getByText(/30% return is a projection/i)).toBeVisible();
  await expect(page.getByText(/contractually guarantees/i)).toBeVisible();
  await page.goto("/privacy");
  await expect(
    page.getByText(/normally retained for five years/i),
  ).toBeVisible();
  await page.goto("/terms");
  await expect(
    page.getByText(/private investment-club arrangement/i),
  ).toBeVisible();
});

test("privacy page offers a visible route back to partner login", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/privacy");
  const login = page.getByRole("link", { name: "Partner login" });
  await expect(login).toBeVisible();
  await login.click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "Email me a secure link" })).toBeVisible();
});

test("native email waits for Continue and offers recovery for an invalid link", async ({ page }) => {
  const template = readFileSync(
    new URL("../../supabase/templates/magic-link.html", import.meta.url),
    "utf8",
  );
  const href = template.match(/href="([^"]*{{ \.TokenHash }}[^"]*)"/)?.[1];
  if (!href) throw new Error("Magic-link template is missing its sign-in link");
  const origin = "http://127.0.0.1:3000";
  const rendered = href
    .replaceAll("&amp;", "&")
    .replace("{{ .SiteURL }}", origin)
    .replace("{{ .TokenHash }}", "test-token-not-a-real-credential")
    .replace("{{ .RedirectTo }}", `${origin}/auth/confirm?next=%2Fdashboard`);
  const redemptions: string[] = [];
  await page.route(`${origin}/auth/confirm`, async (route) => {
    redemptions.push(route.request().method());
    expect(route.request().postDataJSON()).toEqual({
      token_hash: "test-token-not-a-real-credential",
      type: "email",
      next: "/dashboard",
    });
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, redirectTo: "/login?error=invalid_link" }),
    });
  });
  // A fresh browser context has no cookie from the browser requesting the email.
  await page.goto(rendered);
  const continueButton = page.getByRole("button", { name: "Continue securely" });
  await expect(continueButton).toBeVisible();
  await expect(page).toHaveURL(`${origin}/auth/start`);
  expect(redemptions).toEqual([]);
  await continueButton.click();
  await expect(page).toHaveURL(`${origin}/login?error=invalid_link`);
  await expect(page.getByRole("button", { name: "Email me a fresh link" })).toBeVisible();
  expect(redemptions).toEqual(["POST"]);
});
