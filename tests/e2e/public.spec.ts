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
    page.getByText(/unrestricted sign-up is disabled/i),
  ).toBeVisible();
});
test("legal launch gates are visible", async ({ page }) => {
  for (const path of ["/privacy", "/terms", "/risk-disclosure"]) {
    await page.goto(path);
    await expect(page.getByText(/launch gate/i)).toBeVisible();
  }
});
