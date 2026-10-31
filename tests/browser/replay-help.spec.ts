import { test, expect, type Page } from "@playwright/test";
import { CARD_MAP, PRESETS } from "../../src/game/cards";
import type { Profile } from "../../src/game/profile";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const initial: Profile = {
  version: 1,
  name: "Replay Learner",
  trophies: 321,
  best: 400,
  gold: 4567,
  wins: 4,
  battles: 12,
  crowns: 15,
  chests: ["gold"],
  deck: [...PRESETS[0].deck],
  decks: PRESETS.slice(0, 3).map((p) => [...p.deck]),
  activeDeck: 0,
  sound: false,
  music: false,
  emotesMuted: false,
  seenTutorial: true,
  history: [
    {
      id: 1,
      date: "2026-10-31T12:00:00.000Z",
      winner: "red",
      crowns: [0, 0],
      mode: "classic",
      opponent: "Replay Rival",
      opponentType: "ai",
      playerName: "Recorded Learner",
      replay: {
        version: 56,
        rulesFamily: "origin",
        seed: 1,
        mode: "classic",
        deck: [...PRESETS[0].deck],
        enemyDeck: [...PRESETS[1].deck],
        actions: [],
        duration: 1800,
      },
    },
  ],
};
const state = (page: Page) =>
  page.evaluate(() => (window as any).__arena?.state);
for (const originallyPaused of [false, true]) {
  test(`${originallyPaused ? "paused" : "running"} replay help explains playback shortcuts and retains draft settings and playback state`, async ({
    page,
  }, info) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      ({ key, initial }) => localStorage.setItem(key, JSON.stringify(initial)),
      { key, initial },
    );
    if (info.project.name !== "desktop")
      await page.setViewportSize({ width: 320, height: 740 });
    await page.goto("/");
    await expect
      .poll(async () => (await state(page))?.loadedCards, { timeout: 60000 })
      .toBe(expectedCards);
    await page.getByRole("button", { name: "Battle log", exact: true }).click();
    await page.locator('[data-replay="0"]').click();
    await page
      .getByRole("button", { name: "Pause replay", exact: true })
      .click();
    await page.locator("#replay-seek").fill("20");
    await expect.poll(async () => (await state(page)).time).toBe(12);
    await page.locator("#replay-speed").click();
    await page
      .getByRole("button", { name: "View opponent side", exact: true })
      .click();
    await expect(page.locator("#replay-side")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    if (!originallyPaused)
      await page
        .getByRole("button", { name: "Resume replay", exact: true })
        .click();
    await page
      .getByRole("button", { name: "Battle settings", exact: true })
      .click();
    const held = await state(page);
    expect(held.paused).toBe(true);
    await page.locator("#player-name").fill("Unsaved Learner");
    const help = page.locator("#settings-help");
    await help.click();
    await expect(
      page.getByRole("heading", { name: "Replay controls", exact: true }),
    ).toBeVisible();
    for (const text of [
      "Open Plays",
      "View opponent side",
      "View recorded player side",
      "Back to replay",
      "Restart replay",
    ])
      await expect(page.getByRole("dialog")).toContainText(text);
    const shortcuts = page.locator(".keyboard-help");
    for (const text of [
      "Inspect hand card",
      "Skip ten seconds",
      "Home",
      "End",
      "Previous / next play",
      "Pause / resume",
    ])
      await expect(shortcuts).toContainText(text);
    await expect(shortcuts).not.toContainText("Select card");
    await expect(shortcuts).not.toContainText("Deploy");
    for (const viewport of [
      { width: 320, height: 740 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(viewport);
      expect(
        await page
          .getByRole("dialog")
          .evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
      ).toBe(true);
    }
    await page.setViewportSize({ width: 320, height: 740 });
    expect(
      await page
        .locator(".help-steps p")
        .first()
        .evaluate((e) => parseFloat(getComputedStyle(e).fontSize)),
    ).toBeGreaterThanOrEqual(13);
    expect(
      await shortcuts.evaluate((e) => parseFloat(getComputedStyle(e).fontSize)),
    ).toBeGreaterThanOrEqual(11);
    await page.getByRole("dialog").evaluate((e) => {
      e.scrollTop = 0;
    });
    await page.screenshot({
      path: info.outputPath("replay-help.png"),
      animations: "disabled",
    });
    await shortcuts.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath("replay-help-shortcuts.png"),
      animations: "disabled",
    });
    expect((await state(page)).time).toBe(held.time);
    await page
      .getByRole("button", { name: "Back to settings", exact: true })
      .click();
    await expect(help).toBeFocused();
    await expect(page.locator("#player-name")).toHaveValue("Unsaved Learner");
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    expect((await state(page)).paused).toBe(originallyPaused);
    if (originallyPaused) expect((await state(page)).time).toBe(held.time);
    else
      await expect
        .poll(async () => (await state(page)).time)
        .toBeGreaterThan(held.time);
    await expect(page.locator("#replay-side")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator("#replay-speed")).toHaveText("2×");
    await page.locator("#arena-canvas canvas").focus();
    const hand = (await state(page)).hand;
    await page.keyboard.press("1");
    await expect(page.locator("#modal-title")).toHaveText(
      CARD_MAP[hand[0]].name,
    );
    await page
      .getByRole("button", { name: "Back to replay", exact: true })
      .click();
    expect((await state(page)).paused).toBe(originallyPaused);
    await expect(page.locator("#replay-side")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator("#replay-speed")).toHaveText("2×");
    expect(
      await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key),
    ).toEqual(initial);
    expect(errors).toEqual([]);
  });
}
