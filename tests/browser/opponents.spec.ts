import { test, expect, type Page } from "@playwright/test";
import { SOLO_OPPONENTS } from "../../src/game/opponents";
import { expectedEffects } from "./native-assets";
import { readFileSync } from "node:fs";
import { soloOpponent } from "../../src/game/opponents";

const state = (page: Page) =>
  page.evaluate(() => (window as any).__arena?.state);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // The battle seed stays fixed across reload, so changing opponents must
    // come from the completed-match history rather than another random draw.
    Math.random = () => 0;
    if (!localStorage.getItem("browser-royale.profile.v1"))
      localStorage.setItem(
        "browser-royale.profile.v1",
        JSON.stringify({ version: 1, seenTutorial: true, sound: false }),
      );
  });
  await page.goto("/");
  await expect
    .poll(async () => (await state(page))?.loadedEffects, { timeout: 60000 })
    .toBe(expectedEffects);
});

async function finish(page: Page) {
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  await page.getByRole("button", { name: "Leave battle", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Watch replay", exact: true }),
  ).toBeVisible({ timeout: 20000 });
  return page.evaluate(() =>
    JSON.parse(localStorage.getItem("browser-royale.profile.v1")!),
  );
}

test("named AI decks survive history and replay, and a reload avoids repeating the last opponent", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.locator("#battle-button").click();
  await expect(page.locator(".competitor.enemy b")).toHaveText(
    soloOpponent(1, "classic").name,
  );
  const first = await state(page),
    definition = SOLO_OPPONENTS.find(
      (opponent) => opponent.name === first.opponentName,
    )!;
  expect(first.enemyDeck).toEqual(definition.deck);
  await expect(page.locator(".competitor.enemy div > span")).toHaveText(
    `${definition.style} · AI opponent`,
  );
  await expect
    .poll(async () => (await state(page)).actions, { timeout: 30000 })
    .toBeGreaterThan(0);
  if (info.project.name !== "desktop") {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  const enemy = await page.locator(".competitor.enemy").boundingBox(),
    timer = await page.locator(".match-timer").boundingBox();
  expect(enemy!.x + enemy!.width).toBeLessThanOrEqual(timer!.x);
  await page.screenshot({
    path: info.outputPath("named-ai-opponent.png"),
    fullPage: true,
  });
  const profile = await finish(page),
    record = profile.history[0];
  expect(record).toMatchObject({
    opponent: first.opponentName,
    opponentType: "ai",
    replay: { enemyDeck: definition.deck },
  });
  expect(profile.gold).toBe(1025);
  await page.getByRole("button", { name: "Watch replay", exact: true }).click();
  await expect(page.locator(".competitor.enemy b")).toHaveText(
    first.opponentName,
  );
  await expect(page.locator(".competitor.enemy div > span")).toHaveText(
    "AI battle replay",
  );
  expect((await state(page)).enemyDeck).toEqual(definition.deck);
  const timeline = page.getByRole("slider", { name: "Replay timeline" });
  await timeline.focus();
  await timeline.press("End");
  await expect(
    page.getByRole("button", { name: "Restart replay", exact: true }),
  ).toBeVisible();
  await page.locator("#replay-exit").click();
  await page.reload();
  await page.locator("#battle-button").click();
  await expect(page.locator(".competitor.enemy b")).not.toHaveText(
    first.opponentName,
  );
  const next = await state(page),
    nextDefinition = SOLO_OPPONENTS.find(
      (opponent) => opponent.name === next.opponentName,
    )!;
  expect(next.enemyDeck).toEqual(nextDefinition.deck);
  expect(errors).toEqual([]);
});

test("Training retains its original opponent across rematches and awards no ranked rewards", async ({
  page,
}) => {
  await page.locator(".mode-select").click();
  await page.locator('[data-mode="training"]').click();
  await page.locator("#battle-button").click();
  await expect(page.locator(".competitor.enemy b")).toHaveText("Royal Trainer");
  expect((await state(page)).enemyDeck).toEqual(SOLO_OPPONENTS[0].deck);
  await expect(page.locator("#battle-intro")).toHaveAttribute(
    "data-clip",
    "pvp_battle_start_training",
  );
  const profile = await finish(page);
  expect(profile).toMatchObject({
    gold: 1000,
    trophies: 0,
    chests: [],
    history: [
      { mode: "training", opponent: "Royal Trainer", opponentType: "ai" },
    ],
  });
  await page.getByRole("button", { name: "Battle again", exact: true }).click();
  await expect(page.locator(".competitor.enemy b")).toHaveText("Royal Trainer");
  expect((await state(page)).enemyDeck).toEqual(SOLO_OPPONENTS[0].deck);
});

test("an older unnamed solo replay still prevents the original opponent repeating", async ({
  page,
}) => {
  const replay = JSON.parse(
    readFileSync("tests/fixtures/combat-v4-replay.json", "utf8"),
  ).replay;
  await page.addInitScript((replay) => {
    const key = "browser-royale.profile.v1",
      profile = JSON.parse(localStorage.getItem(key)!);
    profile.history = [
      {
        id: 4,
        date: "2026-10-22T12:00:00.000Z",
        mode: replay.mode,
        winner: "red",
        crowns: [0, 3],
        replay,
      },
    ];
    localStorage.setItem(key, JSON.stringify(profile));
  }, replay);
  await page.reload();
  await expect
    .poll(async () => (await state(page))?.loadedEffects, { timeout: 60000 })
    .toBe(expectedEffects);
  await page.getByRole("button", { name: "Battle log", exact: true }).click();
  await expect(page.locator("[data-replay]")).toHaveCount(1);
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  const seed = Array.from({ length: 100 }, (_, i) => i + 1).find(
    (seed) => soloOpponent(seed, "classic").name === "Royal Trainer",
  )!;
  await page.evaluate((seed) => {
    Math.random = () => (seed - 0.5) / 2147483646;
  }, seed);
  await page.locator("#battle-button").click();
  await expect(page.locator(".competitor.enemy b")).not.toHaveText(
    "Royal Trainer",
  );
});
