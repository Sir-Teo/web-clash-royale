import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { PRESETS, type CardId } from "../../src/game/cards";
import { expectedCards } from "./native-assets";

const key = "browser-royale.profile.v1";
const replay = JSON.parse(
  readFileSync("tests/fixtures/combat-v4-replay.json", "utf8"),
).replay;
const state = (page: Page) =>
  page.evaluate(() => (window as any).__arena?.state);
const saved = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);

for (const red of [false, true])
  for (const side of ["opponent", "yours"] as const)
    test(`practices the ${side === "yours" ? "player" : "opponent"} deck from an imported ${red ? "red-side" : "blue-side"} replay as the local player`, async ({
      page,
    }, info) => {
      test.setTimeout(180000);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(
        ({ key, deck }) => {
          localStorage.setItem(
            key,
            JSON.stringify({
              version: 1,
              name: "Receiving Captain",
              deck,
              sound: false,
              music: false,
              seenTutorial: true,
              gold: 5432,
              trophies: 321,
              best: 400,
              wins: 4,
              battles: 12,
              crowns: 15,
              chests: ["gold"],
              decks: [deck, deck, deck],
              activeDeck: 0,
              history: [],
            }),
          );
        },
        { key, deck: PRESETS[2].deck },
      );
      await page.goto("/");
      await expect
        .poll(async () => (await state(page))?.loadedCards, { timeout: 60000 })
        .toBe(expectedCards);
      const before = await saved(page);
      const imported = {
        format: "browser-royale-replay",
        version: 1,
        playerName: "Sending Captain",
        match: {
          date: "2026-10-24T12:00:00.000Z",
          mode: replay.mode,
          winner: red ? "blue" : "red",
          crowns: red ? [3, 0] : [0, 3],
          opponent: "Shared Rival",
          opponentType: "friend",
          replay: {
            ...structuredClone(replay),
            version: 5,
            ...(red ? { perspective: "red" } : {}),
          },
        },
      };
      await page
        .getByRole("button", { name: "Battle log", exact: true })
        .click();
      await page.locator("#replay-file").setInputFiles({
        name: "friendly-replay.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(imported)),
      });
      const mode = red ? "classic" : "double";
      const pace = page.getByRole("combobox", {
        name: "Practice pace",
        exact: true,
      });
      await expect(pace).toHaveValue("training");
      await pace.selectOption(mode);
      const target = page.getByRole("combobox", {
        name: "Practice opponent deck",
        exact: true,
      });
      await expect(target).toHaveValue("opponent");
      await target.selectOption(side);
      await page.locator("[data-shared-card]").last().click();
      await page
        .getByRole("button", { name: "Back to shared replay", exact: true })
        .click();
      await expect(pace).toHaveValue(mode);
      await expect(target).toHaveValue(side);
      const practice = page.getByRole("button", {
        name: "Practice against this deck",
        exact: true,
      });
      await expect(practice).toHaveAttribute(
        "aria-describedby",
        "practice-shared-note",
      );
      await expect(page.locator("#practice-shared-note")).toContainText(
        "No trophies or rewards",
      );
      expect(await saved(page)).toEqual(before);
      if (info.project.name !== "desktop")
        await page.setViewportSize({ width: 320, height: 740 });
      await practice.scrollIntoViewIfNeeded();
      expect((await practice.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(
        await page
          .getByRole("dialog")
          .evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth + 1),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath("shared-replay-practice.png"),
        animations: "disabled",
      });
      if (await page.evaluate(() => navigator.maxTouchPoints > 0))
        await practice.tap();
      else {
        await practice.focus();
        await practice.press("Enter");
      }
      const enemyDeck =
        (side === "yours") === red ? replay.enemyDeck : replay.deck;
      const targetName = side === "yours" ? "Sending Captain" : "Shared Rival";
      const rounds = red && side === "opponent" ? 2 : 1;
      for (let round = 0; round < rounds; round++) {
        await expect(page.locator(".match-bottom .player-name")).toHaveText(
          before.name,
        );
        await expect(page.locator(".competitor.enemy b")).toHaveText(
          targetName,
        );
        await expect(
          page.locator(".competitor.enemy div > span"),
        ).toContainText(
          `${red ? "Classic 1v1" : "Double elixir"} · Practice AI`,
        );
        expect((await state(page)).enemyDeck).toEqual(enemyDeck);
        expect(
          (await state(page)).hand.every((id: CardId) =>
            before.deck.includes(id),
          ),
        ).toBe(true);
        await expect
          .poll(async () => (await state(page)).actions, { timeout: 30000 })
          .toBeGreaterThan(0);
        await page
          .getByRole("button", { name: "Pause battle", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Leave battle", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: "Practice again", exact: true }),
        ).toBeVisible({ timeout: 20000 });
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
        expect(after.history).toHaveLength(round + 1);
        expect(after.history[0]).toMatchObject({
          practice: true,
          playerName: before.name,
          opponent: targetName,
          opponentType: "ai",
          mode,
          replay: {
            version: 56,
            rulesFamily: "origin",
            mode,
            deck: before.deck,
            enemyDeck,
          },
        });
        expect(after.history[0].matchId).toBeUndefined();
        expect(after.history[0].replay.perspective).toBeUndefined();
        if (round + 1 < rounds)
          await page
            .getByRole("button", { name: "Practice again", exact: true })
            .click();
      }
      await page
        .getByRole("button", { name: "Watch replay", exact: true })
        .click();
      await expect(page.locator(".match-bottom .player-name")).toHaveText(
        before.name,
      );
      expect((await state(page)).enemyDeck).toEqual(enemyDeck);
      await page.locator("#replay-exit").click();
      await expect(page.locator("#mode-name")).toHaveText("Classic 1v1");
      await page
        .getByRole("button", { name: "Battle log", exact: true })
        .click();
      await expect(page.locator("[data-match-details]")).toHaveCount(rounds);
      expect(errors).toEqual([]);
    });
