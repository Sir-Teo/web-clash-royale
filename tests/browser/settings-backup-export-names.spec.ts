import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";

test("backup names use the session player and precise UTC time while Settings drafts stay unsaved", async ({
  page,
}) => {
  await page.addInitScript((key) => {
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        name: "Élodie / 王小明",
        gold: 4321,
        seenTutorial: true,
        sound: false,
        music: false,
      }),
    );
  }, key);
  await page.goto("/");
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__arena?.state.loadedCards),
      { timeout: 60000 },
    )
    .toBe(expectedCards);
  const before = await page.evaluate((key) => localStorage.getItem(key), key);
  await page
    .getByRole("button", { name: "Battle settings", exact: true })
    .click();
  await page.locator("#player-name").fill("Draft Captain");
  const names: string[] = [];
  const profiles: unknown[] = [];
  for (const fraction of [125, 126]) {
    await page.clock.setFixedTime(new Date(`2026-10-31T12:00:00.${fraction}Z`));
    const pending = page.waitForEvent("download");
    await page.locator("#export-progress").click();
    const download = await pending;
    names.push(download.suggestedFilename());
    const backup = JSON.parse(await readFile((await download.path())!, "utf8"));
    expect(backup.profile).toMatchObject({
      name: "Élodie / 王小明",
      gold: 4321,
    });
    profiles.push(backup.profile);
    await expect(page.locator("#player-name")).toHaveValue("Draft Captain");
  }
  expect(names).toEqual([
    "browser-arena-progress-2026-10-31T12-00-00.125Z-for-elodie-王小明.json",
    "browser-arena-progress-2026-10-31T12-00-00.126Z-for-elodie-王小明.json",
  ]);
  expect(profiles[0]).toEqual(profiles[1]);
  for (const name of names) {
    expect(name).not.toMatch(/[\\/:*?"<>|\u0000-\u001f]/u);
    expect(Buffer.byteLength(name, "utf8")).toBeLessThan(255);
  }
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    before,
  );
});
