import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PRESETS, STARTER_DECK } from "../../src/game/cards";
import type { RecordEntry } from "../../src/game/profile";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const history: RecordEntry[] = [
  "Royal Trainer",
  "Élodie / 王小明: Final?",
  "龍".repeat(64),
].map((opponent, index) => ({
  id: index,
  date:
    index === 2 ? "2026-10-31T23:30:00.125-02:00" : "2026-10-31T12:00:00.000Z",
  mode: "classic",
  winner: "draw",
  crowns: [0, 0],
  opponent,
  playerName: "File Learner",
  opponentType: "friend",
  matchId: "private-room",
  replay: {
    version: 56,
    rulesFamily: "origin",
    seed: index,
    mode: "classic",
    deck: [...STARTER_DECK],
    enemyDeck: [...PRESETS[1].deck],
    duration: 600,
    actions: [],
  },
}));

test("export names distinguish same-time rivals, normalize portable Unicode names and retain the original replay metadata", async ({
  page,
}) => {
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
            name: "Local Learner",
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
  const names: string[] = [];
  for (let index = 0; index < history.length; index++) {
    await page.locator(`[data-match-details="${index}"]`).click();
    const pending = page.waitForEvent("download");
    await page.locator("#export-replay-file").click();
    const download = await pending;
    const name = download.suggestedFilename();
    names.push(name);
    expect(name).not.toMatch(/[\\/:*?"<>|\u0000-\u001f]/u);
    expect(Buffer.byteLength(name, "utf8")).toBeLessThan(255);
    const contents = JSON.parse(
      await readFile((await download.path())!, "utf8"),
    );
    expect(contents.match.opponent).toBe(history[index].opponent);
    expect(contents.match.date).toBe(history[index].date);
    expect(contents.playerName).toBe("File Learner");
    expect(contents.match).not.toHaveProperty("matchId");
    expect(contents.match).not.toHaveProperty("id");
    expect(contents).not.toHaveProperty("profile");
    await page.locator("#match-log").click();
  }
  expect(names[0]).toBe(
    "browser-arena-replay-2026-10-31T12-00-00.000Z-vs-royal-trainer.json",
  );
  expect(names[1]).toBe(
    "browser-arena-replay-2026-10-31T12-00-00.000Z-vs-elodie-王小明-final.json",
  );
  expect(names[2]).toMatch(
    /^browser-arena-replay-2026-11-01T01-30-00\.125Z-vs-龍+\.json$/u,
  );
  expect(new Set(names).size).toBe(3);
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    before,
  );
  expect(errors).toEqual([]);
});
