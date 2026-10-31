import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { CARD_MAP, PRESETS, STARTER_DECK } from "../../src/game/cards";
import { encodeDeckCode } from "../../src/game/deck-code";
import type { Replay } from "../../src/game/engine";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const replay: Replay = {
  ...JSON.parse(readFileSync("tests/fixtures/combat-v4-replay.json", "utf8"))
    .replay,
  version: 5,
};
const state = (page: Page) =>
  page.evaluate(() => (window as any).__arena.state);

for (const perspective of ["blue", "red"] as const)
  test(`${perspective} replay deck inspection follows the viewed side and retains playback and Settings drafts`, async ({
    page,
  }, info) => {
    test.setTimeout(150000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      ({ key, replay, perspective, deck, decks }) => {
        localStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            name: "Deck Student",
            gold: 2345,
            trophies: 123,
            best: 123,
            wins: 3,
            battles: 4,
            crowns: 5,
            chests: ["gold"],
            seenTutorial: true,
            sound: false,
            music: false,
            emotesMuted: false,
            activeDeck: 0,
            deck,
            decks,
            history: [
              {
                id: 42,
                date: "2026-10-24T12:00:00.000Z",
                mode: replay.mode,
                playerName: "Recorded Pilot",
                opponent: "Other King",
                opponentType: "friend",
                winner: "red",
                crowns: [0, 3],
                replay: { ...replay, perspective },
              },
            ],
          }),
        );
      },
      {
        key,
        replay,
        perspective,
        deck: PRESETS[2].deck,
        decks: [PRESETS[2].deck, STARTER_DECK, PRESETS[1].deck],
      },
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
    const saved = await page.evaluate((key) => localStorage.getItem(key), key);
    await page.getByRole("button", { name: "Battle log", exact: true }).click();
    await page.locator("[data-replay]").click();
    await page.locator("#replay-play").click();
    await page.locator("#replay-seek").fill("20");
    await page.locator("#replay-speed").click();
    for (const opponentView of [false, true]) {
      if (opponentView) await page.locator("#replay-side").click();
      const frozen = await state(page);
      await page.locator("#arena-settings").click();
      await page.locator("#player-name").fill("Unsaved Reader");
      const opener = page.locator("#settings-replay-decks");
      expect((await opener.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await opener.click();
      await expect(
        page.getByRole("dialog", {
          name: "Replay starting decks",
          exact: true,
        }),
      ).toBeVisible();
      const redView = (perspective === "red") !== opponentView;
      const viewed = redView ? replay.enemyDeck : replay.deck;
      const other = redView ? replay.deck : replay.enemyDeck;
      for (const [side, cards, name] of [
        ["viewed", viewed, opponentView ? "Other King" : "Recorded Pilot"],
        ["opponent", other, opponentView ? "Recorded Pilot" : "Other King"],
      ] as const) {
        const section = page.locator(`[data-replay-deck-side="${side}"]`);
        await expect(section.locator("h3")).toHaveText(name);
        expect(
          await section
            .locator("[data-replay-deck-card]")
            .evaluateAll((buttons) =>
              buttons.map(
                (button) => (button as HTMLElement).dataset.nativeCard,
              ),
            ),
        ).toEqual(cards);
      }
      await expect(
        page.locator(
          "#try-card-practice,[data-use-match-deck],#match-deck-slot",
        ),
      ).toHaveCount(0);
      const card = page
        .locator('[data-replay-deck-side="viewed"] [data-replay-deck-card]')
        .first();
      await card.focus();
      await card.press("Enter");
      await expect(page.locator("#modal-title")).toHaveText(
        CARD_MAP[viewed[0]].name,
      );
      await expect(page.locator("#try-card-practice")).toHaveCount(0);
      await page.locator("#card-back").click();
      await expect(card).toBeFocused();
      const share = page.locator('[data-replay-deck-code="viewed"]');
      await share.click();
      await expect(page.locator("#battle-deck-code-value")).toHaveValue(
        encodeDeckCode(viewed),
      );
      await page.locator("#battle-code-back").click();
      await expect(share).toBeFocused();
      if (opponentView)
        await page.screenshot({
          path: info.outputPath("replay-starting-decks.png"),
          animations: "disabled",
        });
      expect(await state(page)).toMatchObject({
        time: frozen.time,
        speed: 2,
        paused: true,
        hand: frozen.hand,
      });
      await page.locator("#replay-decks-back").click();
      await expect(page.locator("#player-name")).toHaveValue("Unsaved Reader");
      await expect(opener).toBeFocused();
      await page.locator(".close-modal").click();
      expect(await state(page)).toMatchObject({
        time: frozen.time,
        speed: 2,
        paused: true,
      });
    }
    await page.locator("#replay-play").click();
    await page.locator("#arena-settings").click();
    const stopped = (await state(page)).time;
    await page.locator("#settings-replay-decks").click();
    await page.locator(".close-modal").click();
    await expect
      .poll(async () => (await state(page)).time)
      .toBeGreaterThan(stopped);
    expect((await state(page)).paused).toBe(false);
    expect((await state(page)).speed).toBe(2);
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
      saved,
    );
    expect(errors).toEqual([]);
  });
