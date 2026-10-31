import { test, expect } from "@playwright/test";
import { PRESETS, STARTER_DECK } from "../../src/game/cards";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const durations = [0, 90, 5400, 9000];
const lengths = ["0:00 played", "0:03 played", "3:00 played", "5:00 played"];
const history = durations.map((duration, index) => ({
  id: index,
  date: "2026-10-31T12:00:00.000Z",
  mode: "double",
  practice: true,
  winner: "draw",
  crowns: [0, 0],
  opponent: `Length Rival ${index}`,
  opponentType: "ai",
  replay: {
    version: 56,
    rulesFamily: "origin",
    seed: index,
    mode: "double",
    deck: [...STARTER_DECK],
    enemyDeck: [...PRESETS[1].deck],
    duration,
    actions: [],
  },
}));

test("battle log keeps mode, date and recorded length readable across narrow and rotated layouts", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(
    ({ key, history }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            name: "Length Learner",
            sound: false,
            music: false,
            seenTutorial: true,
            history,
          }),
        );
    },
    { key, history },
  );
  await page.goto("/");
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__arena?.state.loadedCards),
      { timeout: 60000 },
    )
    .toBe(expectedCards);
  const before = await page.evaluate((key) => localStorage.getItem(key), key);
  await page.getByRole("button", { name: "Battle log", exact: true }).click();
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 320, height: 740 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    expect(
      await page
        .getByRole("dialog")
        .evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
    ).toBe(true);
    for (let index = 0; index < lengths.length; index++) {
      const row = page.locator(`[data-history-index="${index}"]`);
      await row.scrollIntoViewIfNeeded();
      await expect(row.locator(".history-duration")).toHaveText(lengths[index]);
      await expect(row.locator("time")).toHaveAttribute(
        "datetime",
        history[index].date,
      );
      await expect(row.locator(".history-record-meta")).toContainText(
        "Double elixir · Practice",
      );
      for (const label of await row
        .locator(":scope > div > b, :scope > div > b > small")
        .all())
        expect(
          await label.evaluate((e) => parseFloat(getComputedStyle(e).fontSize)),
        ).toBeGreaterThanOrEqual(12);
      const type = await row.locator(".history-record-meta").evaluate((e) => ({
        size: parseFloat(getComputedStyle(e).fontSize),
        line: parseFloat(getComputedStyle(e).lineHeight),
      }));
      expect(type.size).toBeGreaterThanOrEqual(12);
      expect(type.line).toBeGreaterThanOrEqual(type.size * 1.4);
      const text = (await row.locator(".history-record-meta").boundingBox())!;
      const score = (await row.locator(":scope > strong").boundingBox())!;
      expect(text.x + text.width).toBeLessThanOrEqual(score.x + 1);
      for (const action of await row.locator("button").all()) {
        const bounds = (await action.boundingBox())!;
        expect(bounds.height).toBeGreaterThanOrEqual(44);
        expect(bounds.width).toBeGreaterThanOrEqual(44);
      }
    }
    await page.locator('[data-history-index="0"]').scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath(`history-length-${viewport.width}.png`),
      animations: "disabled",
    });
  }
  await page.locator('[data-match-details="1"]').click();
  await expect(page.locator(".match-metadata")).toContainText("0:03 played");
  await page.locator("#match-log").click();
  await expect(page.locator('[data-match-details="1"]')).toBeFocused();
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    before,
  );
  expect(errors).toEqual([]);
});
