import { test, expect, type Page } from "@playwright/test";
import { STARTER_DECK, PRESETS } from "../../src/game/cards";
import { SOLO_OPPONENTS } from "../../src/game/opponents";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const state = (page: Page) =>
  page.evaluate(() => (window as any).__arena.state);
for (const practice of [false, true])
  test(`${practice ? "practice" : "ordinary"} replay returns to its retained result and starts a fresh attempt without recording twice`, async ({
    page,
  }, info) => {
    test.setTimeout(150000);
    await page.addInitScript(
      ({ key, deck, decks }) => {
        localStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            name: "Return Captain",
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
      await page.locator("#practice-opponent").selectOption("7");
      await page.locator("#practice-pace").selectOption("double");
      await page.locator("#practice-speed").selectOption("2");
      await page.locator("#start-practice").click();
    } else await page.locator("#battle-button").click();
    await expect
      .poll(async () => (await state(page)).intro.blocking, { timeout: 15000 })
      .toBe(false);
    await expect
      .poll(async () => (await state(page)).time)
      .toBeGreaterThan(0.3);
    await page.locator("#pause-button").click();
    await page.locator("#surrender-button").click();
    await expect(page.locator("#watch-replay")).toBeVisible({ timeout: 30000 });
    const saved = await page.evaluate((key) => localStorage.getItem(key), key);
    const after = JSON.parse(saved!);
    expect(after.history).toHaveLength(1);
    const watch = page.locator("#watch-replay");
    await watch.scrollIntoViewIfNeeded();
    const scroll = await page
      .locator(".modal")
      .evaluate((element) => element.scrollTop);
    await watch.click();
    await expect(page.locator("#replay-exit")).toHaveAttribute(
      "aria-label",
      "Back to result",
    );
    await page.locator("#replay-speed").click();
    await page.locator("#replay-seek").fill("100");
    await expect(page.locator("#replay-play")).toHaveAttribute(
      "aria-label",
      "Restart replay",
    );
    await page.locator("#replay-play").click();
    await expect(page.locator("#replay-exit")).toHaveAttribute(
      "aria-label",
      "Back to result",
    );
    await expect(page.locator("#replay-speed")).toHaveText("2×");
    await page.locator("#replay-side").click();
    await page.locator("#replay-seek").fill("100");
    await page.locator("#replay-exit").click();
    await expect(page.locator("#modal-title")).toHaveText("A crown to chase.");
    await expect(watch).toBeFocused();
    expect(
      Math.abs(
        (await page
          .locator(".modal")
          .evaluate((element) => element.scrollTop)) - scroll,
      ),
    ).toBeLessThanOrEqual(2);
    await expect(page.locator("#rematch")).toHaveText(
      practice ? "Practice again" : "Battle again",
    );
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
      saved,
    );
    await page.screenshot({
      path: info.outputPath("returned-battle-result.png"),
      animations: "disabled",
    });
    await page.locator("#rematch").click();
    expect((await state(page)).speed).toBe(practice ? 2 : 1);
    if (practice)
      expect((await state(page)).enemyDeck).toEqual(SOLO_OPPONENTS[7].deck);
    await page.locator("#pause-button").click();
    await page.locator("#inspect-battle-deck").click();
    expect(
      await page
        .locator("[data-battle-card]")
        .evaluateAll((cards) =>
          cards.map((card) => (card as HTMLElement).dataset.nativeCard),
        ),
    ).toEqual(practice ? SOLO_OPPONENTS[6].deck : STARTER_DECK);
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
      saved,
    );
  });
