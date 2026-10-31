import { test, expect, type Page } from "@playwright/test";
const state = (page: Page) =>
  page.evaluate(() => (window as any).__arena.state);
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "browser-royale.profile.v1",
      JSON.stringify({
        version: 1,
        seenTutorial: true,
        sound: false,
        music: false,
      }),
    ),
  );
  await page.goto("/");
  await page.locator("#battle-button").click();
  await expect
    .poll(async () => (await state(page)).intro.blocking, { timeout: 15000 })
    .toBe(false);
});

test("pause is a focused dialog with a frozen clock and isolated controls", async ({
  page,
}, info) => {
  await page.locator("canvas").focus();
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("dialog", { name: "Battle paused", exact: true }),
  ).toBeVisible();
  const resume = page.getByRole("button", {
    name: "Resume battle",
    exact: true,
  });
  const leave = page.getByRole("button", { name: "Leave battle", exact: true });
  const close = page.getByRole("button", { name: "Close dialog", exact: true });
  await expect(resume).toBeFocused();
  const frozen = await state(page);
  await page.waitForTimeout(250);
  expect((await state(page)).time).toBe(frozen.time);
  expect((await state(page)).actions).toBe(frozen.actions);
  await page.locator("canvas").evaluate((e) => e.focus());
  await expect(resume).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Inspect battle deck", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(leave).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(resume).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(close).toBeFocused();
  if (info.project.name !== "mobile")
    await page.screenshot({
      path: info.outputPath("pause-menu.png"),
      animations: "disabled",
    });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await state(page)).paused).toBe(false);
  await expect(page.locator("canvas")).toBeFocused();
  await expect
    .poll(async () => (await state(page)).time)
    .toBeGreaterThan(frozen.time);
});

test("holding Space opens once and Resume, close and backdrop all resume", async ({
  page,
}) => {
  await page.locator("canvas").focus();
  await page.keyboard.down("Space");
  await page.keyboard.down("Space");
  await page.keyboard.up("Space");
  expect((await state(page)).paused).toBe(true);
  await expect(page.locator("#resume-button")).toBeFocused();
  await page.keyboard.press("Enter");
  expect((await state(page)).paused).toBe(false);
  await expect(page.locator("canvas")).toBeFocused();
  await page.locator("#pause-button").click();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  expect((await state(page)).paused).toBe(false);
  await page.locator("#pause-button").click();
  await page.locator(".modal-backdrop").click({ position: { x: 3, y: 3 } });
  expect((await state(page)).paused).toBe(false);
  expect(
    await page.locator(".app-shell").evaluate((e) => (e as HTMLElement).inert),
  ).toBe(false);
});

test("leaving from the pause menu records one result and releases the lobby", async ({
  page,
}) => {
  await page.locator("#pause-button").click();
  await page.keyboard.press("Tab");
  await expect(page.locator("#inspect-battle-deck")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator("#surrender-button")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await state(page)).winner).toBe("red");
  await expect(page.locator("#return-home")).toBeVisible({ timeout: 15000 });
  await page.locator("#return-home").click();
  expect((await state(page)).screen).toBe("lobby");
  const profile = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("browser-royale.profile.v1")!),
  );
  expect(profile.history).toHaveLength(1);
  expect(profile.battles).toBe(1);
  expect(profile.history[0].winner).toBe("red");
  expect(
    await page.locator(".app-shell").evaluate((e) => (e as HTMLElement).inert),
  ).toBe(false);
  await page.locator("#battle-button").click();
  await expect.poll(async () => (await state(page)).screen).toBe("battle");
  expect((await state(page)).paused).toBe(false);
});
