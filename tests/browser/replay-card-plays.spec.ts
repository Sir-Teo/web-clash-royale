import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const fixture = JSON.parse(
  readFileSync("tests/fixtures/combat-v4-replay.json", "utf8"),
).replay;
const replay = {
  ...fixture,
  version: 5,
  duration: 600,
  actions: fixture.actions.filter(
    (action: { tick: number }) => action.tick < 300,
  ),
};
const state = (page: Page) =>
  page.evaluate(() => (window as any).__arena.state);
for (const perspective of ["blue", "red"] as const)
  test(`${perspective} card inspection jumps to its own recorded plays and leaves unused cards read-only`, async ({
    page,
  }, info) => {
    test.setTimeout(150000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      ({ key, replay, perspective }) => {
        localStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            name: "Play Finder",
            sound: false,
            music: false,
            seenTutorial: true,
            history: [
              {
                id: 42,
                date: "2026-10-24T12:00:00.000Z",
                mode: replay.mode,
                playerName: "Recorded Pilot",
                opponent: "Other King",
                winner: "red",
                crowns: [0, 3],
                replay: { ...replay, perspective },
              },
            ],
          }),
        );
      },
      { key, replay, perspective },
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
    await page.locator("#replay-seek").fill("0");
    await page.locator("#replay-speed").click();
    const id = perspective === "blue" ? "arrows" : "mini-pekka";
    const target = perspective === "blue" ? 1 : 130;
    const hand = page.locator(`#hand [data-native-card="${id}"]`);
    if (info.project.name === "desktop") {
      await hand.focus();
      await hand.press("Enter");
    } else await hand.tap();
    await expect(page.locator("#replay-card-previous")).toBeDisabled();
    const next = page.locator("#replay-card-next");
    await expect(next).toHaveText(
      perspective === "blue" ? "Next play · 0:00" : "Next play · 0:04",
    );
    expect((await next.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await next.click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await state(page)).time).toBeCloseTo(target / 30, 9);
    expect(await state(page)).toMatchObject({
      paused: true,
      speed: 2,
      selected: -1,
    });
    await expect(page.locator("#arena-canvas canvas")).toBeFocused();
    async function openDecks() {
      await page.locator("#arena-settings").click();
      await page.locator("#settings-replay-decks").click();
    }
    await openDecks();
    const own = page.locator(
      `[data-replay-deck-side="viewed"] [data-native-card="${id}"]`,
    );
    await own.click();
    await expect(page.locator(".replay-card-plays > p")).toHaveText(
      "Viewed side · 1 recorded play",
    );
    await expect(page.locator("#replay-card-next")).toBeDisabled();
    await expect(page.locator("#replay-card-previous")).toBeDisabled();
    // Red Mini P.E.K.K.A must not borrow blue's later tick-260 play.
    await page.locator("#card-back").click();
    await expect(own).toBeFocused();
    await page
      .locator('[data-replay-deck-side="viewed"] [data-native-card="fireball"]')
      .click();
    await expect(page.locator(".replay-card-plays > p")).toHaveText(
      "Viewed side · Not played in this recording",
    );
    await expect(page.locator("#replay-card-next")).toBeDisabled();
    await expect(page.locator("#replay-card-previous")).toBeDisabled();
    await page.locator(".close-modal").click();
    await page.locator("#arena-canvas canvas").focus();
    await page.keyboard.press("End");
    await expect(page.locator("#replay-play")).toHaveAttribute(
      "aria-label",
      "Restart replay",
    );
    await page.locator("#replay-side").click();
    await openDecks();
    await page
      .locator(`[data-replay-deck-side="opponent"] [data-native-card="${id}"]`)
      .click();
    await expect(page.locator(".replay-card-plays > p")).toHaveText(
      "Opponent · 1 recorded play",
    );
    await expect(page.locator("#replay-card-next")).toBeDisabled();
    await expect(page.locator("#replay-card-previous")).toBeEnabled();
    await expect(page.locator(".replay-card-plays > small")).toHaveText(
      "Jumps pause at the selected play.",
    );
    await page.locator(".replay-card-plays").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath("replay-card-previous-play.png"),
      animations: "disabled",
    });
    await page.locator("#replay-card-previous").click();
    expect((await state(page)).time).toBeCloseTo(target / 30, 9);
    expect(await state(page)).toMatchObject({ paused: true, speed: 2 });
    expect((await state(page)).music.rate).toBe(2);
    await expect(page.locator("#replay-side")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator("#replay-play")).toHaveAttribute(
      "aria-label",
      "Resume replay",
    );
    await expect(page.locator("#arena-canvas canvas")).toBeFocused();
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
      saved,
    );
    expect(errors).toEqual([]);
  });
