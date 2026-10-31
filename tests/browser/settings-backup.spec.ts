import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PRESETS, STARTER_DECK } from "../../src/game/cards";
import type { Profile } from "../../src/game/profile";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const initial: Profile = {
  version: 1,
  name: "Backup Inspector",
  trophies: 123,
  best: 200,
  gold: 3456,
  wins: 3,
  battles: 9,
  crowns: 11,
  chests: ["silver"],
  history: [],
  deck: [...STARTER_DECK],
  decks: [[...STARTER_DECK], [...PRESETS[1].deck], [...PRESETS[2].deck]],
  activeDeck: 0,
  sound: false,
  music: false,
  emotesMuted: false,
  seenTutorial: true,
};

test("cancelling backup previews retains draft settings, their controls and the original scroll position", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(
    ({ key, initial }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify(initial));
      let fullscreen = false;
      Object.defineProperty(document, "fullscreenElement", {
        get: () => (fullscreen ? document.documentElement : null),
        configurable: true,
      });
      (window as any).__setSettingsFullscreen = (value: boolean) => {
        fullscreen = value;
        document.dispatchEvent(new Event("fullscreenchange"));
      };
    },
    { key, initial },
  );
  if (info.project.name !== "desktop")
    await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).__arena);
  const before = await page.evaluate((key) => localStorage.getItem(key), key);
  await page.locator("#arena-settings").click();
  const name = page.getByRole("textbox", { name: "PLAYER NAME", exact: true });
  const originalName = await name.elementHandle();
  const sound = page.getByRole("checkbox", {
    name: "Sound effects",
    exact: true,
  });
  const music = page.getByRole("checkbox", {
    name: "Battle music",
    exact: true,
  });
  await name.fill("Draft Inspector");
  await sound.check();
  await music.check();
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export progress", exact: true })
    .click();
  const download = await downloadEvent;
  const buffer = await readFile((await download.path())!);
  expect(JSON.parse(buffer.toString("utf8")).profile.name).toBe(initial.name);
  const file = {
    name: download.suggestedFilename(),
    mimeType: "application/json",
    buffer,
  };
  const restore = page.getByRole("button", {
    name: "Restore backup",
    exact: true,
  });
  const originalRestore = await restore.elementHandle();
  for (const attempt of [0, 1]) {
    await restore.scrollIntoViewIfNeeded();
    const scroll = await page.getByRole("dialog").evaluate((e) => e.scrollTop);
    const chooserEvent = page.waitForEvent("filechooser");
    if (info.project.name === "desktop") await restore.click();
    else await restore.tap();
    const chooser = await chooserEvent;
    expect(await page.locator("#progress-file").inputValue()).toBe("");
    await chooser.setFiles(file);
    await expect(page.locator("#modal-title")).toHaveText(
      "Restore your kingdom?",
    );
    await expect(page.locator(".restore-progress h3")).toHaveText(initial.name);
    await page.evaluate(
      (value) => (window as any).__setSettingsFullscreen(value),
      attempt === 0,
    );
    await page
      .getByRole("button", { name: "Keep current progress", exact: true })
      .click();
    await expect(name).toHaveValue("Draft Inspector");
    await expect(sound).toBeChecked();
    await expect(music).toBeChecked();
    await expect(restore).toBeFocused();
    expect(
      await name.evaluate(
        (element, original) => element === original,
        originalName,
      ),
    ).toBe(true);
    expect(
      await restore.evaluate(
        (element, original) => element === original,
        originalRestore,
      ),
    ).toBe(true);
    expect(
      Math.abs(
        (await page.getByRole("dialog").evaluate((e) => e.scrollTop)) - scroll,
      ),
    ).toBeLessThanOrEqual(1);
    await expect(page.locator("#fullscreen")).toHaveAttribute(
      "aria-pressed",
      String(attempt === 0),
    );
    await expect(restore).toBeEnabled();
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
      before,
    );
  }
  await page.getByRole("dialog").evaluate((e) => {
    e.scrollTop = 0;
  });
  await page.screenshot({
    path: info.outputPath("settings-retained-backup-draft.png"),
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  expect(
    await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key),
  ).toEqual({ ...initial, name: "Draft Inspector", sound: true, music: true });
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__arena);
  await page.locator("#arena-settings").click();
  await expect(name).toHaveValue("Draft Inspector");
  await expect(sound).toBeChecked();
  await expect(music).toBeChecked();
  expect(errors).toEqual([]);
});
