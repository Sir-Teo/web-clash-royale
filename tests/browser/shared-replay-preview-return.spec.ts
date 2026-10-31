import { test, expect, type Page } from "@playwright/test";
import { PRESETS, STARTER_DECK } from "../../src/game/cards";
import type { Profile, RecordEntry } from "../../src/game/profile";
import { expectedCards } from "./native-assets";
import { exportReplayFile } from "../../src/game/replay-file";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const record: RecordEntry = {
  id: 1,
  date: "2026-10-31T12:00:00.000Z",
  winner: "draw",
  crowns: [0, 0],
  mode: "classic",
  opponent: "Recorded Rival",
  opponentType: "ai",
  playerName: "Recorded Learner",
  replay: {
    version: 56,
    rulesFamily: "origin",
    seed: 123,
    mode: "classic",
    deck: [...STARTER_DECK],
    enemyDeck: [...PRESETS[2].deck],
    duration: 60,
    actions: [],
  },
};
const profile: Profile = {
  version: 1,
  name: "Local Learner",
  trophies: 321,
  best: 400,
  gold: 4321,
  wins: 4,
  battles: 12,
  crowns: 15,
  chests: ["gold"],
  deck: [...STARTER_DECK],
  decks: [[...STARTER_DECK], [...PRESETS[1].deck], [...PRESETS[0].deck]],
  activeDeck: 0,
  sound: false,
  music: false,
  emotesMuted: false,
  seenTutorial: true,
  history: [record],
};
const saved = (page: Page) =>
  page.evaluate((key) => localStorage.getItem(key), key);

for (const source of ["local", "shared"] as const) {
  test(`${source} preview retains destination, Undo, pace, scroll and focus through playback and restart`, async ({
    page,
  }, info) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      ({ key, profile }) => {
        if (!localStorage.getItem(key))
          localStorage.setItem(key, JSON.stringify(profile));
      },
      { key, profile },
    );
    if (info.project.name !== "desktop")
      await page.setViewportSize({ width: 320, height: 740 });
    await page.goto("/");
    await expect
      .poll(
        () => page.evaluate(() => (window as any).__arena?.state.loadedCards),
        { timeout: 60000 },
      )
      .toBe(expectedCards);
    const before = await saved(page);
    await page.getByRole("button", { name: "Battle log", exact: true }).click();
    if (source === "local") {
      await page.locator("[data-match-details]").click();
    } else {
      await page.locator("#replay-file").setInputFiles({
        name: "preview-return.json",
        mimeType: "application/json",
        buffer: Buffer.from(exportReplayFile(record, profile.name)),
      });
      await expect(
        page.getByRole("heading", { name: "Shared replay", exact: true }),
      ).toBeVisible();
    }
    const prefix = source === "local" ? "match" : "shared";
    const slot = page.locator(`#${prefix}-deck-slot`);
    const watch = page.locator(
      source === "local" ? "#match-replay" : "#watch-shared-replay",
    );
    const undo = page.locator(`#undo-${prefix}-deck`);
    const label =
      source === "local" ? "Back to battle details" : "Back to shared replay";
    await slot.selectOption("1");
    await page.locator(`[data-use-${prefix}-deck="opponent"]`).click();
    await expect(undo).toBeVisible();
    await slot.selectOption("2");
    await page.locator("#practice-pace").selectOption("double");
    if (source === "shared")
      await page.locator("#practice-shared-side").selectOption("opponent");
    await watch.scrollIntoViewIfNeeded();
    await watch.focus();
    const scroll = await page.getByRole("dialog").evaluate((e) => {
      (window as any).__previewBeforePlayback = e;
      return e.scrollTop;
    });
    const adopted = await saved(page);
    if (info.project.name === "desktop") await watch.press("Enter");
    else await watch.tap();
    await expect(page.locator("#replay-exit")).toHaveAttribute(
      "aria-label",
      label,
    );
    await page.locator("#replay-speed").click();
    await page.locator("#replay-side").click();
    await page.locator("#replay-seek").fill("100");
    await page
      .getByRole("button", { name: "Restart replay", exact: true })
      .click();
    await expect(page.locator("#replay-speed")).toHaveText("2×");
    await expect(page.locator("#replay-side")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator("#replay-exit")).toHaveAttribute(
      "aria-label",
      label,
    );
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(watch).toBeFocused();
    expect(
      await page
        .getByRole("dialog")
        .evaluate((e) => e === (window as any).__previewBeforePlayback),
    ).toBe(true);
    expect(
      await page.getByRole("dialog").evaluate((e) => e.scrollTop),
    ).toBeCloseTo(scroll, 0);
    await expect(slot).toHaveValue("2");
    await expect(page.locator("#practice-pace")).toHaveValue("double");
    if (source === "shared")
      await expect(page.locator("#practice-shared-side")).toHaveValue(
        "opponent",
      );
    expect(await saved(page)).toBe(adopted);
    await page.screenshot({
      path: info.outputPath(`${source}-preview-return.png`),
      animations: "disabled",
    });
    await undo.click();
    const restored = await saved(page);
    expect(JSON.parse(restored!)).toEqual(JSON.parse(before!));
    await watch.click();
    await expect(page.locator("#replay-exit")).toHaveAttribute(
      "aria-label",
      label,
    );
    await page.locator("#replay-exit").click();
    await expect(watch).toBeFocused();
    await expect(undo).toHaveCount(0);
    await page
      .getByRole("button", { name: "Back to battle log", exact: true })
      .click();
    await expect(
      page.locator(
        source === "local" ? "[data-match-details]" : "#open-replay-file",
      ),
    ).toBeVisible();
    expect(await saved(page)).toBe(restored);
    expect(errors).toEqual([]);
  });
}
