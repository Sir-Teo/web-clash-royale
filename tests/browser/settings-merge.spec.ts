import { test, expect, type Page } from "@playwright/test";
import { PRESETS, STARTER_DECK } from "../../src/game/cards";
import type { Profile } from "../../src/game/profile";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const initial: Profile = {
  version: 1,
  name: "Original King",
  trophies: 321,
  best: 400,
  gold: 4567,
  wins: 4,
  battles: 12,
  crowns: 15,
  chests: ["gold"],
  history: [],
  deck: [...PRESETS[2].deck],
  decks: [[...STARTER_DECK], [...PRESETS[1].deck], [...PRESETS[2].deck]],
  activeDeck: 2,
  sound: false,
  music: false,
  emotesMuted: false,
  seenTutorial: true,
};
const incoming: Profile = {
  ...initial,
  name: "Other Captain",
  gold: 4917,
  chests: [],
  wins: 5,
  battles: 13,
  crowns: 18,
  deck: [...PRESETS[1].deck],
  activeDeck: 1,
  sound: true,
  music: true,
  emotesMuted: true,
  history: [
    {
      id: 2,
      date: "2026-10-30T12:00:00.000Z",
      mode: "classic",
      practice: true,
      playerName: "Other Captain",
      opponent: "Practice Rival",
      opponentType: "ai",
      winner: "blue",
      crowns: [3, 0],
      replay: {
        version: 56,
        rulesFamily: "origin",
        seed: 1,
        mode: "classic",
        deck: [...PRESETS[1].deck],
        enemyDeck: [...STARTER_DECK],
        actions: [],
        duration: 0,
      },
    },
  ],
};
const loaded = (page: Page) =>
  expect
    .poll(
      () => page.evaluate(() => (window as any).__arena?.state.loadedCards),
      { timeout: 60000 },
    )
    .toBe(expectedCards);
const saved = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);

for (const edit of ["name", "sound"] as const) {
  test(`saving an open ${edit} draft keeps newer progress and untouched settings from another tab`, async ({
    page,
    context,
  }, info) => {
    test.setTimeout(180000);
    await page.addInitScript(
      ({ key, initial }) => {
        if (!localStorage.getItem(key))
          localStorage.setItem(key, JSON.stringify(initial));
      },
      { key, initial },
    );
    await page.goto("/");
    await loaded(page);
    const editor = await context.newPage();
    if (info.project.name !== "desktop")
      await editor.setViewportSize({ width: 320, height: 740 });
    await editor.goto("/");
    await loaded(editor);
    await editor.bringToFront();
    await editor
      .getByRole("button", { name: "Battle settings", exact: true })
      .click();
    if (edit === "name") {
      await editor.locator("#player-name").fill("  Local Captain  ");
      await editor.locator("#settings-help").click();
      await editor
        .getByRole("button", { name: "Back to settings", exact: true })
        .click();
      await expect(editor.locator("#player-name")).toHaveValue(
        "  Local Captain  ",
      );
    } else await editor.locator("#sound-setting").check();
    await editor.evaluate(
      (key) =>
        window.addEventListener("storage", (event) => {
          if (event.key === key) (window as any).__otherSettingsSaved = true;
        }),
      key,
    );
    const newer = edit === "sound" ? { ...incoming, sound: false } : incoming;
    await page.evaluate(
      ({ key, newer }) => localStorage.setItem(key, JSON.stringify(newer)),
      { key, newer },
    );
    await expect
      .poll(() => editor.evaluate(() => (window as any).__otherSettingsSaved))
      .toBe(true);
    await editor
      .getByRole("button", { name: "Save settings", exact: true })
      .click();
    const expected =
      edit === "name"
        ? { ...newer, name: "Local Captain" }
        : { ...newer, sound: true };
    expect(await saved(editor)).toEqual(expected);
    await expect(editor.locator(".player-card .player-name")).toHaveText(
      expected.name,
    );
    await expect(editor.locator("#gold")).toHaveText("4,917");
    await expect
      .poll(() =>
        editor.evaluate(() => (window as any).__arena?.state.emotes.muted),
      )
      .toBe(true);
    await editor.reload();
    await loaded(editor);
    expect(await saved(editor)).toEqual(expected);
    await expect(editor.locator(".player-card .player-name")).toHaveText(
      expected.name,
    );
  });
}
