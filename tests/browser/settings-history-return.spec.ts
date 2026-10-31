import { test, expect } from "@playwright/test";
import { PRESETS, STARTER_DECK } from "../../src/game/cards";
import type { Profile, RecordEntry } from "../../src/game/profile";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const history: RecordEntry[] = Array.from({ length: 10 }, (_, index) => ({
  id: 1,
  date: `2026-10-${28 - index}T12:00:00.000Z`,
  winner: "draw",
  crowns: [0, 0],
  mode: "classic",
  opponent: `Focus Rival ${index}`,
  opponentType: "ai",
  replay: {
    version: 56,
    rulesFamily: "origin",
    seed: index,
    mode: "classic",
    deck: [...STARTER_DECK],
    enemyDeck: [...PRESETS[2].deck],
    duration: 60,
    actions: [],
  },
}));
const profile: Profile = {
  version: 1,
  name: "History Learner",
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
  history,
};

for (const change of ["unchanged", "prepended", "removed"] as const) {
  test(`battle log return tracks the viewed recording after ${change} saved history and a deck action`, async ({
    page,
  }, info) => {
    test.setTimeout(90000);
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
    await page.getByRole("button", { name: "Battle log", exact: true }).click();
    await page.locator("#history-search").fill("Focus Rival");
    await page.locator("#history-result").selectOption("draw");
    const details = page.locator('[data-match-details="6"]');
    await details.scrollIntoViewIfNeeded();
    await details.focus();
    const scroll = await page.evaluate(() => ({
      panel: document.querySelector(".modal")!.scrollTop,
      list: document.querySelector(".history-list")!.scrollTop,
    }));
    expect(scroll.list).toBeGreaterThan(0);
    await details.click();
    await page.evaluate(
      ({ key, change }) => {
        const saved = JSON.parse(localStorage.getItem(key)!);
        saved.name = "Current Learner";
        if (change === "prepended") {
          saved.history.unshift({
            ...saved.history[0],
            opponent: "Newest Rival",
            date: "2026-10-31T12:00:00.000Z",
          });
          saved.history = saved.history.slice(0, 10);
          saved.battles++;
        } else if (change === "removed") saved.history.splice(6, 1);
        localStorage.setItem(key, JSON.stringify(saved));
      },
      { key, change },
    );
    await page.locator("#match-deck-slot").selectOption("1");
    await page.locator('[data-use-match-deck="opponent"]').click();
    await expect(page.locator(".match-result span")).toHaveText(
      "vs Focus Rival 6",
    );
    await page.locator("#undo-match-deck").click();
    const beforeReturn = await page.evaluate(
      (key) => localStorage.getItem(key),
      key,
    );
    await page.locator("#match-log").click();
    await expect(page.locator("#history-search")).toHaveValue("Focus Rival");
    await expect(page.locator("#history-result")).toHaveValue("draw");
    if (change === "removed") {
      await expect(page.locator("#history-search")).toBeFocused();
      await expect(
        page.getByRole("button", {
          name: "View battle details against Focus Rival 6",
          exact: true,
        }),
      ).toHaveCount(0);
    } else {
      const index = change === "prepended" ? 7 : 6;
      const returned = page.locator(`[data-match-details="${index}"]`);
      await expect(returned).toBeFocused();
      await expect(returned).toBeInViewport();
      if (change === "unchanged")
        expect(
          await page.evaluate(() => ({
            panel: document.querySelector(".modal")!.scrollTop,
            list: document.querySelector(".history-list")!.scrollTop,
          })),
        ).toEqual(scroll);
      await returned.click();
      await expect(page.locator(".match-result span")).toHaveText(
        "vs Focus Rival 6",
      );
    }
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
      beforeReturn,
    );
    expect(errors).toEqual([]);
    await page.screenshot({
      path: info.outputPath(`history-return-${change}.png`),
      animations: "disabled",
    });
  });
}

test("direct replay returns to the same recording after newer saved results shift its row", async ({
  page,
}, info) => {
  test.setTimeout(90000);
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
  await page.getByRole("button", { name: "Battle log", exact: true }).click();
  await page.locator("#history-search").fill("Focus Rival");
  await page.locator('[data-replay="6"]').click();
  await expect(page.locator(".competitor.enemy b")).toHaveText("Focus Rival 6");
  const current = await page.evaluate((key) => {
    const saved = JSON.parse(localStorage.getItem(key)!);
    saved.name = "Current Learner";
    saved.history.unshift({
      ...saved.history[0],
      opponent: "Newest Rival",
      date: "2026-10-31T12:00:00.000Z",
    });
    saved.history = saved.history.slice(0, 10);
    saved.battles++;
    const current = JSON.stringify(saved);
    localStorage.setItem(key, current);
    return current;
  }, key);
  await page.locator("#replay-exit").click();
  await expect(page.locator(".player-card .player-name")).toHaveText(
    "Current Learner",
  );
  await page.getByRole("button", { name: "Battle log", exact: true }).click();
  await expect(page.locator("#history-search")).toHaveValue("Focus Rival");
  await expect(page.locator('[data-replay="7"]')).toBeFocused();
  await expect(page.locator('[data-replay="7"]')).toBeInViewport();
  await page.locator('[data-match-details="7"]').click();
  await expect(page.locator(".match-result span")).toHaveText(
    "vs Focus Rival 6",
  );
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    current,
  );
});
