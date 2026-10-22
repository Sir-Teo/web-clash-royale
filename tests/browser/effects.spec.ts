import { test, expect } from "@playwright/test";

test("a paused Fireball does not keep emitting trail particles", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/combat.html");
  await expect(page.locator("#status")).toContainText("18 effects", {
    timeout: 30000,
  });
  await page.getByRole("button", { name: "Step 0.1s", exact: true }).click();
  await expect(page.locator("#status")).toContainText("0.1s");
  const particles = await page.locator("#particles").textContent();
  await page.waitForTimeout(500);
  await expect(page.locator("#particles")).toHaveText(particles!);
  await expect(page.locator("#status")).toContainText("0.1s");
});
