import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

const key = "browser-royale.profile.v1";

test("settings report a failed save, remain exportable, and persist after storage recovers", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((key) => {
    if (!localStorage.getItem(key))
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          name: "Saved King",
          sound: false,
          music: false,
          seenTutorial: true,
        }),
      );
  }, key);
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).__arena);
  const stored = await page.evaluate((key) => localStorage.getItem(key), key);
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    (window as any).__restoreSettingsStorage = () => {
      Storage.prototype.setItem = original;
    };
    Storage.prototype.setItem = function (name, value) {
      if (name === key)
        throw new DOMException("Storage is full", "QuotaExceededError");
      return original.call(this, name, value);
    };
  }, key);
  const settings = page.getByRole("button", {
    name: "Battle settings",
    exact: true,
  });
  const save = page.getByRole("button", { name: "Save settings", exact: true });
  await settings.click();
  await page.locator("#player-name").fill("Session King");
  await page.locator("#sound-setting").check();
  await page.locator("#music-setting").check();
  await save.click();
  await expect(page.locator("#toast")).toHaveText(
    "Settings applied for this session. Browser storage is unavailable.",
    { timeout: 1500 },
  );
  await expect(page.locator(".player-card .player-name")).toHaveText(
    "Session King",
  );
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    stored,
  );
  await settings.click();
  await expect(page.locator(".save-note")).toContainText(
    "Browser storage is unavailable",
  );
  await expect(page.locator(".save-note")).toContainText("Export a backup");
  await expect(page.locator("#sound-setting")).toBeChecked();
  await expect(page.locator("#music-setting")).toBeChecked();
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export progress", exact: true })
    .click();
  const download = await downloadEvent;
  const backup = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(backup.profile).toMatchObject({
    name: "Session King",
    sound: true,
    music: true,
  });
  await page.screenshot({
    path: info.outputPath("session-settings.png"),
    fullPage: true,
  });
  await page.evaluate(() => (window as any).__restoreSettingsStorage());
  await save.click();
  await expect(page.locator("#toast")).toHaveText("Settings saved.");
  expect(
    JSON.parse((await page.evaluate((key) => localStorage.getItem(key), key))!),
  ).toEqual(backup.profile);
  await settings.click();
  await expect(page.locator(".save-note")).toHaveText(
    "Progress saves automatically on this browser.",
  );
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__arena);
  await expect(page.locator(".player-card .player-name")).toHaveText(
    "Session King",
  );
  await settings.click();
  await expect(page.locator("#sound-setting")).toBeChecked();
  await expect(page.locator("#music-setting")).toBeChecked();
  expect(errors).toEqual([]);
});
