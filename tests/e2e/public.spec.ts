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
