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

test("Wi-Fi HTTP invite copies without the secure clipboard API", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "browser-royale.profile.v1",
      JSON.stringify({ version: 1, seenTutorial: true, sound: false }),
    );
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined,
    });
    document.addEventListener("copy", () => {
      const source = document.activeElement as HTMLTextAreaElement;
      (window as any).__copiedInvite = source.value.slice(
        source.selectionStart,
        source.selectionEnd,
      );
    });
  });
  await page.goto("/");
  await page.locator("#friend-button").click();
  await page.getByRole("button", { name: "Create an invite" }).click();
  const field = page.locator("#peer-share");
  await expect(field).toHaveValue(/^CR1\./, { timeout: 30000 });
  const code = await field.inputValue();
  await expect(page.locator("#share-peer")).toHaveCount(0);
  await page.getByRole("button", { name: "Copy invite" }).click();
  await expect(page.locator("#toast")).toHaveText(
    "Copied. Send it to your friend.",
  );
  expect(await page.evaluate(() => (window as any).__copiedInvite)).toBe(code);
  await page.evaluate(() => {
    document.execCommand = () => false;
  });
  await page.getByRole("button", { name: "Copy invite" }).click();
  await expect(page.locator("#toast")).toHaveText(
    "Selected. Use your browser’s Copy action.",
  );
  expect(
    await field.evaluate((element: HTMLTextAreaElement) =>
      element.value.slice(element.selectionStart, element.selectionEnd),
    ),
  ).toBe(code);
});
