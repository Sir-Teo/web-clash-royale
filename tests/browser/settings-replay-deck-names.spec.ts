import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { STARTER_DECK, PRESETS } from "../../src/game/cards";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const playerName = "<b>Pilot</b>";
const opponent = "A".repeat(64);
const replay = {
  ...JSON.parse(readFileSync("tests/fixtures/combat-v4-replay.json", "utf8"))
    .replay,
  version: 5,
  perspective: "red",
};
test("recorded deck names stay literal and fit summaries and share titles in both viewing sides and phone orientations", async ({
  page,
}, info) => {
  await page.addInitScript(
    ({ key, replay, playerName, opponent, deck, decks }) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          name: "Name Student",
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
              playerName,
              opponent,
              winner: "red",
              crowns: [0, 3],
              replay,
            },
          ],
        }),
      );
    },
    {
      key,
      replay,
      playerName,
      opponent,
      deck: STARTER_DECK,
      decks: [STARTER_DECK, PRESETS[1].deck, PRESETS[2].deck],
    },
  );
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
  for (const opponentView of [false, true]) {
    if (opponentView) await page.locator("#replay-side").click();
    await page.locator("#arena-settings").click();
    await page.locator("#settings-replay-decks").click();
    for (const width of [320, 740]) {
      await page.setViewportSize({ width, height: width === 320 ? 740 : 320 });
      await page.screenshot({
        path: info.outputPath(`replay-deck-names-${opponentView}-${width}.png`),
        animations: "disabled",
      });
      for (const [side, name] of [
        ["viewed", opponentView ? opponent : playerName],
        ["opponent", opponentView ? playerName : opponent],
      ] as const) {
        const section = page.locator(`[data-replay-deck-side="${side}"]`);
        await expect(section.locator("h3")).toHaveText(name);
        const bounds = await section.evaluate((element) => {
          const heading = element.querySelector("h3")!;
          const summary = element.querySelector(".match-deck-heading > span")!;
          const range = document.createRange();
          range.selectNodeContents(heading);
          return {
            textRight: range.getBoundingClientRect().right,
            summaryLeft: summary.getBoundingClientRect().left,
            overflow: element.scrollWidth - element.clientWidth,
          };
        });
        expect(bounds.textRight).toBeLessThanOrEqual(bounds.summaryLeft - 4);
        expect(bounds.overflow).toBeLessThanOrEqual(1);
        const share = section.locator("[data-replay-deck-code]");
        await share.click();
        await expect(page.locator("#modal-title")).toHaveText(
          `${name}'s replay deck code`,
        );
        await expect(page.locator("#modal-title b")).toHaveCount(0);
        const titleBounds = await page
          .locator(".modal-heading")
          .evaluate((element) => {
            const range = document.createRange();
            range.selectNodeContents(element.querySelector("h2")!);
            return {
              right: range.getBoundingClientRect().right,
              close: element
                .querySelector(".close-modal")!
                .getBoundingClientRect().left,
            };
          });
        expect(titleBounds.right).toBeLessThanOrEqual(titleBounds.close - 4);
        await page.locator("#battle-code-back").click();
        await expect(share).toBeFocused();
      }
    }
    await page.locator(".close-modal").click();
  }
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    saved,
  );
});
