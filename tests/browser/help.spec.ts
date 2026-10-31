import { test, expect, type Page } from "@playwright/test";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const saved = (page: Page) =>
  page.evaluate((key) => localStorage.getItem(key), key);
const state = (page: Page) =>
  page.evaluate(() => (window as any).__arena?.state);

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        name: "Learning King",
        sound: false,
        music: false,
        seenTutorial: true,
      }),
    );
  }, key);
  await page.goto("/");
  await expect
    .poll(async () => (await state(page))?.loadedCards, { timeout: 60000 })
    .toBe(expectedCards);
});

test("opens help from phone settings and restores unsaved controls and focus", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const before = await saved(page);
  if (info.project.name !== "desktop")
    await page.setViewportSize({ width: 320, height: 740 });
  await page
    .getByRole("button", { name: "Battle settings", exact: true })
    .click();
  await page.locator("#player-name").fill("New Learner");
  await page.locator("#sound-setting").check();
  await page.locator("#music-setting").check();
  const help = page.locator("#settings-help");
  await help.scrollIntoViewIfNeeded();
  expect((await help.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const scroll = await page
    .getByRole("dialog")
    .evaluate((dialog) => dialog.scrollTop);
  await help.click();
  await expect(
    page.getByRole("heading", {
      name: "Your first crown starts here.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText(
    "The Log starts on your side",
  );
  await expect(page.getByRole("dialog")).toContainText(
    "Miner can tunnel across the river",
  );
  for (const viewport of [
    { width: 320, height: 740 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    expect(
      await page
        .getByRole("dialog")
        .evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth + 1),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page
      .locator(".help-steps p")
      .first()
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
  ).toBeGreaterThanOrEqual(13);
  expect(
    await page
      .locator(".keyboard-help")
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
  ).toBeGreaterThanOrEqual(11);
  await page.getByRole("dialog").evaluate((dialog) => (dialog.scrollTop = 0));
  await page.screenshot({
    path: info.outputPath("phone-help.png"),
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Back to settings", exact: true })
    .click();
  await expect(help).toBeFocused();
  await expect(page.locator("#player-name")).toHaveValue("New Learner");
  await expect(page.locator("#sound-setting")).toBeChecked();
  await expect(page.locator("#music-setting")).toBeChecked();
  // Compare scroll at the same phone size used when Settings was left.
  if (info.project.name !== "desktop")
    expect(
      await page.getByRole("dialog").evaluate((dialog) => dialog.scrollTop),
    ).toBeCloseTo(scroll, 0);
  expect(await saved(page)).toBe(before);
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Battle settings", exact: true }),
  ).toBeFocused();
  expect(JSON.parse((await saved(page))!)).toMatchObject({
    name: "New Learner",
    sound: true,
    music: true,
  });
  expect(errors).toEqual([]);
});

test("keeps a solo battle paused through help and resumes after closing settings", async ({
  page,
}) => {
  const before = await saved(page);
  await page.locator("#battle-button").click();
  await expect.poll(async () => (await state(page)).time).toBeGreaterThan(0);
  await page
    .getByRole("button", { name: "Battle settings", exact: true })
    .click();
  await expect.poll(async () => (await state(page)).paused).toBe(true);
  const pausedTime = (await state(page)).time;
  await page.locator("#settings-help").click();
  await expect(
    page.getByRole("heading", {
      name: "Your first crown starts here.",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Back to settings", exact: true })
    .click();
  expect((await state(page)).time).toBe(pausedTime);
  expect((await state(page)).paused).toBe(true);
  expect(await saved(page)).toBe(before);
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect.poll(async () => (await state(page)).paused).toBe(false);
  await expect
    .poll(async () => (await state(page)).time)
    .toBeGreaterThan(pausedTime);
  await expect(page.locator("#arena-canvas canvas")).toBeFocused();
});
