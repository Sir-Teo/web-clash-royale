import { test, expect } from "@playwright/test";

test("phone shares a usable invite code from a localhost game", async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "browser-royale.profile.v1",
      JSON.stringify({
        version: 1,
        seenTutorial: true,
        sound: false,
        music: false,
      }),
    );
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: ShareData) => {
        (window as any).__sharedInvite = data;
      },
    });
  });
  await page.goto("/");
  await page.locator("#friend-button").click();
  await page.getByRole("button", { name: "Create an invite" }).click();
  const field = page.locator("#peer-share");
  await expect(field).toHaveValue(/^CR1\./, { timeout: 30000 });
  await expect(page.locator('label[for="peer-share"]')).toHaveText(
    "INVITE CODE",
  );
  await expect(page.locator(".room-note")).toContainText(
    "computer's Wi-Fi address",
  );
  await page.screenshot({ path: info.outputPath("peer-share.png") });
  const code = await field.inputValue();
  await page.getByRole("button", { name: "Share invite" }).click();
  const shared = await page.evaluate(() => (window as any).__sharedInvite);
  expect(shared.text).toBe(code);
  expect(shared.url).toBeUndefined();
});
