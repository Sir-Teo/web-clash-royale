import { test, expect, type Page } from "@playwright/test";
import { PRESETS, STARTER_DECK } from "../../src/game/cards";
import { SOLO_OPPONENTS } from "../../src/game/opponents";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const initial = {
  version: 1,
  name: "Pace Captain",
  gold: 2345,
  trophies: 300,
  best: 400,
  wins: 4,
  battles: 12,
  crowns: 15,
  chests: ["gold"],
  sound: false,
  music: false,
  seenTutorial: true,
  deck: PRESETS[2].deck,
  decks: [STARTER_DECK, PRESETS[1].deck, PRESETS[2].deck],
  activeDeck: 2,
  history: [
    {
      id: 1,
      date: "2026-10-28T12:00:00.000Z",
      winner: "red",
      crowns: [0, 1],
      mode: "classic",
      opponent: "Recorded Captain",
      opponentType: "friend",
      replay: {
        version: 56,
        rulesFamily: "origin",
        seed: 19,
        mode: "classic",
        deck: STARTER_DECK,
        enemyDeck: PRESETS[1].deck,
        actions: [],
        duration: 1,
      },
    },
  ],
};
const labels = { classic: "Classic 1v1", double: "Double elixir" };
type Source = "curated" | "recorded" | "shared";
const state = (page: Page) =>
  page.evaluate(() => (window as any).__arena?.state);
const saved = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
const pace = (page: Page) =>
  page.getByRole("combobox", { name: "Practice pace", exact: true });
async function open(page: Page, source: Source) {
  if (source === "curated") {
    await page.locator(".mode-select").click();
    await page.locator("#choose-practice-opponent").click();
    await page.locator("#practice-opponent").selectOption("1");
  } else if (source === "recorded") {
    await page.getByRole("button", { name: "Battle log", exact: true }).click();
    await page.locator("[data-match-details]").last().click();
    await page.locator("#match-deck-slot").selectOption("0");
  } else {
    await page
      .getByRole("button", { name: `Cards ${expectedCards}`, exact: true })
      .click();
    await page.locator("#deck-codes").click();
    await page
      .locator("#shared-deck-code")
      .fill("BRA-DECK-1:" + PRESETS[1].deck.join(","));
    await page.locator('#deck-code-form button[type="submit"]').click();
    await page.locator("#code-deck-slot").selectOption("0");
  }
}
async function finish(page: Page) {
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  await page.getByRole("button", { name: "Leave battle", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Practice again", exact: true }),
  ).toBeVisible({ timeout: 20000 });
}

for (const source of ["curated", "recorded", "shared"] as const)
  for (const mode of ["classic", "double"] as const)
    test(`${source} ${mode} practice keeps its pace, rewards and replay separate`, async ({
      page,
    }, info) => {
      test.setTimeout(180000);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(
        ({ key, initial }) => {
          if (!localStorage.getItem(key))
            localStorage.setItem(key, JSON.stringify(initial));
        },
        { key, initial },
      );
      await page.goto("/");
      await expect
        .poll(async () => (await state(page))?.loadedCards, { timeout: 60000 })
        .toBe(expectedCards);
      if (info.project.name !== "desktop")
        await page.setViewportSize({ width: 320, height: 740 });
      const lobbyMode = mode === "double" ? "classic" : "double";
      await page.locator(".mode-select").click();
      await page.locator(`[data-mode="${lobbyMode}"]`).click();
      const before = await saved(page);
      await open(page, source);
      await expect(pace(page)).toHaveValue("training");
      await pace(page).focus();
      await pace(page).selectOption(mode);
      await expect(pace(page)).toBeFocused();
      const card = page
        .locator(
          source === "curated"
            ? "[data-practice-card]"
            : source === "recorded"
              ? "[data-match-card]"
              : "[data-code-card]",
        )
        .last();
      await card.click();
      await page.locator("#card-back").click();
      await expect(pace(page)).toHaveValue(mode);
      expect(await saved(page)).toEqual(before);
      await pace(page).scrollIntoViewIfNeeded();
      const bounds = (await pace(page).boundingBox())!;
      expect(bounds.height).toBeGreaterThanOrEqual(44);
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(
        page.viewportSize()!.width,
      );
      expect(
        await page
          .getByRole("dialog")
          .evaluate(
            (element) => element.scrollWidth <= element.clientWidth + 1,
          ),
      ).toBe(true);
      if (source === "curated" && mode === "double")
        await page.screenshot({
          path: info.outputPath("practice-pace.png"),
          animations: "disabled",
        });
      const start = page.locator(
        source === "curated"
          ? "#start-practice"
          : source === "recorded"
            ? "#practice-recorded-deck"
            : "#practice-code-deck",
      );
      await start.scrollIntoViewIfNeeded();
      if (await page.evaluate(() => navigator.maxTouchPoints > 0))
        await start.tap();
      else {
        await start.focus();
        await start.press("Enter");
      }
      const rounds = source === "curated" && mode === "double" ? 2 : 1;
      for (let round = 0; round < rounds; round++) {
        await expect(page.locator("#battle-intro")).toHaveAttribute(
          "data-clip",
          "pvp_battle_start",
        );
        await expect(
          page.locator(".competitor.enemy div > span"),
        ).toContainText(`${labels[mode]} · Practice AI`);
        expect((await state(page)).enemyDeck).toEqual(
          source === "curated" ? SOLO_OPPONENTS[1].deck : PRESETS[1].deck,
        );
        await expect
          .poll(async () => (await state(page)).actions, { timeout: 30000 })
          .toBeGreaterThan(0);
        await finish(page);
        await expect(page.locator(".practice-result-note")).toHaveText(
          "Practice AI · no trophies or rewards",
        );
        const after = await saved(page);
        for (const field of [
          "gold",
          "trophies",
          "best",
          "chests",
          "deck",
          "decks",
          "activeDeck",
          "wins",
          "crowns",
        ])
          expect(after[field]).toEqual(before[field]);
        expect(after.battles).toBe(before.battles + round + 1);
        expect(after.history[0]).toMatchObject({
          practice: true,
          mode,
          opponentType: "ai",
          replay: { mode, deck: before.deck, enemyDeck: PRESETS[1].deck },
        });
        expect(
          after.history[0].replay.actions.some(
            (action: any) => action.team === "red",
          ),
        ).toBe(true);
        if (round + 1 < rounds) await page.locator("#rematch").click();
      }
      await page.locator("#watch-replay").click();
      await expect(page.locator(".competitor.enemy div > span")).toHaveText(
        "Practice AI replay",
      );
      expect((await state(page)).enemyDeck).toEqual(PRESETS[1].deck);
      await page.locator("#replay-seek").fill("100");
      await expect(page.locator("#replay-play")).toHaveAttribute(
        "aria-label",
        "Restart replay",
      );
      await page.locator("#replay-exit").click();
      await expect(page.locator("#mode-name")).toHaveText(labels[lobbyMode]);
      await page
        .getByRole("button", { name: "Battle log", exact: true })
        .click();
      await expect(page.locator("[data-history-index]").first()).toContainText(
        `${labels[mode]} · Practice`,
      );
      await page.locator("[data-match-details]").first().click();
      await expect(page.locator(".match-metadata")).toContainText(
        `${labels[mode]} · Practice`,
      );
      await expect(pace(page)).toHaveValue(mode);
      await page
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
      await page.reload();
      await expect
        .poll(async () => (await state(page))?.loadedCards, { timeout: 60000 })
        .toBe(expectedCards);
      expect((await saved(page)).history[0]).toMatchObject({
        practice: true,
        mode,
      });
      await open(page, "curated");
      await expect(pace(page)).toHaveValue("training");
      expect(errors).toEqual([]);
    });
