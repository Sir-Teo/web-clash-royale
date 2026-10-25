import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

const key = "browser-royale.profile.v1";

test("pasted player names remain usable in progress backups", async ({
  page,
}) => {
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
  const settings = page.getByRole("button", {
    name: "Battle settings",
    exact: true,
  });
  for (const [name, expected] of [
    ["\u0001Royal\u007f King", "Royal King"],
    ["\u0001\u007f", "Sir Teo"],
    ["👑 Royal Teo", "👑 Royal Teo"],
    ["<b>Royal</b>", "<b>Royal</b>"],
  ]) {
    await settings.click();
    await page.locator("#player-name").fill(name);
    await expect(page.locator("#player-name")).toHaveValue(name);
    await page
      .getByRole("button", { name: "Save settings", exact: true })
      .click();
    await settings.click();
    const downloadEvent = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Export progress", exact: true })
      .click();
    const download = await downloadEvent;
    const file = (await download.path())!;
    const backup = JSON.parse(await readFile(file, "utf8"));
    await page.locator("#progress-file").setInputFiles(file);
    await expect(
      page.getByRole("dialog", { name: "Restore your kingdom?", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".restore-progress h3")).toHaveText(expected);
    expect(backup.profile.name).toBe(expected);
    expect(
      JSON.parse(
        (await page.evaluate((key) => localStorage.getItem(key), key))!,
      ).name,
    ).toBe(expected);
    await page.locator("#cancel-restore").click();
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await expect(page.locator(".player-card .player-name")).toHaveText(
      expected,
    );
  }
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__arena);
  await expect(page.locator(".player-card .player-name")).toHaveText(
    "<b>Royal</b>",
  );
  expect(errors).toEqual([]);
});
