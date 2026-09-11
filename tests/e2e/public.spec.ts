import { expect, test } from "@playwright/test";
test("public landing is responsive and discloses the model", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /aquaculture future/i }),
  ).toBeVisible();
  await expect(page.getByText(/does not move money/i)).toBeVisible();
});
test("login does not offer unrestricted sign-up", async ({ page }) => {
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: /without a password/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /sign up|register|create account/i }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /sign up|register|create account/i }),
  ).toHaveCount(0);
});
test("versioned legal content and compliance gates are visible", async ({
  page,
}) => {
  for (const path of ["/privacy", "/terms", "/risk-disclosure"]) {
    await page.goto(path);
    await expect(page.getByText(/compliance notice/i)).toBeVisible();
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
