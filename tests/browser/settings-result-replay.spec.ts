import { test, expect } from "@playwright/test";
import { STARTER_DECK, PRESETS } from "../../src/game/cards";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
for (const practice of [false, true])
  test(`${practice ? "practice" : "ordinary"} result replay retains its battle when sound refreshes a newer battle log during the ending`, async ({
    page,
  }, info) => {
    await page.addInitScript(
      ({ key, deck, decks }) => {
        localStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            name: "Result Captain",
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
            history: [],
          }),
        );
      },
      {
        key,
        deck: STARTER_DECK,
        decks: [STARTER_DECK, PRESETS[1].deck, PRESETS[2].deck],
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
    if (practice) {
      await page.locator(".mode-select").click();
      await page.locator("#choose-practice-opponent").click();
      await page.locator("#practice-deck").selectOption("curated:6");
      await page.locator("#start-practice").click();
    } else await page.locator("#battle-button").click();
    await page.locator("#pause-button").click();
    // Run after the game's Leave handler in the same event turn, before the
    // ending finishes. The HUD sound action reads the newer saved snapshot.
    await page.evaluate(
      ({ key, otherDeck, otherEnemyDeck }) => {
        document.querySelector("#surrender-button")!.addEventListener(
          "click",
          () => {
            const latest = JSON.parse(localStorage.getItem(key)!);
            const own = latest.history[0];
            if (!own)
              throw new Error("The completed battle must be recorded first.");
            latest.name = "Latest Captain";
            latest.gold += 999;
            latest.battles += 7;
            latest.history = [
              {
                ...own,
                id: 9009,
                playerName: "Other Pilot",
                opponent: "Other Rival",
                replay: {
                  ...own.replay,
                  seed: own.replay.seed + 1,
                  deck: otherDeck,
                  enemyDeck: otherEnemyDeck,
                },
              },
              own,
            ];
            localStorage.setItem(key, JSON.stringify(latest));
            (
              document.querySelector(
                "#battle-sound-button",
              ) as HTMLButtonElement
            ).click();
          },
          { once: true },
        );
      },
      { key, otherDeck: PRESETS[2].deck, otherEnemyDeck: PRESETS[1].deck },
    );
    await page.locator("#surrender-button").click();
    await expect(page.locator("#watch-replay")).toBeVisible({ timeout: 30000 });
    const saved = await page.evaluate((key) => localStorage.getItem(key), key);
    const latest = JSON.parse(saved!);
    expect(latest.name).toBe("Latest Captain");
    expect(latest.sound).toBe(true);
    expect(latest.history).toHaveLength(2);
    expect(latest.history[0].playerName).toBe("Other Pilot");
    const own = latest.history[1];
    expect(own.playerName).toBe("Result Captain");
    await page.locator("#watch-replay").click();
    await expect(page.locator(".match-bottom .player-name")).toHaveText(
      "Result Captain",
    );
    await expect(page.locator(".competitor.enemy b")).toHaveText(own.opponent);
    expect(
      (await page.evaluate(() => (window as any).__arena.state)).enemyDeck,
    ).toEqual(own.replay.enemyDeck);
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
      saved,
    );
  });
