import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";
import { observeCombatAudio, playedCombatAudio } from "./audio-helpers";

const replay = {
  version: 5,
  seed: 1,
  mode: "classic",
  deck: [
    "prince",
    "archers",
    "giant",
    "musketeer",
    "mini-pekka",
    "fireball",
    "arrows",
    "goblins",
  ],
  enemyDeck: [
    "giant",
    "archers",
    "knight",
    "bomber",
    "minions",
    "fireball",
    "mini-pekka",
    "arrows",
  ],
  actions: [{ tick: 0, team: "blue", card: "prince", x: 14, y: 23 }],
  duration: 360,
};

test("Prince charge and charged strike play their archived sounds once during a browser replay", async ({
  page,
}) => {
  test.setTimeout(120000);
  const file = "/assets/audio/rider_charge_03.ogg";
  await observeCombatAudio(page);
  await page.addInitScript(
    (saved) =>
      localStorage.setItem("browser-royale.profile.v1", JSON.stringify(saved)),
    {
      version: 1,
      sound: true,
      music: false,
      seenTutorial: true,
      battles: 1,
      history: [
        {
          id: 1,
          date: "2026-10-23T00:00:00.000Z",
          mode: replay.mode,
          winner: "blue",
          crowns: [1, 0],
          replay,
        },
      ],
    },
  );
  await page.goto("/");
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__arena?.state.loadedEffects),
      {
        timeout: 60000,
      },
    )
    .toBe(expectedEffects);
  await page.getByRole("button", { name: "Battle log", exact: true }).click();
  await page.locator('[data-replay="0"]').click();
  await expect
    .poll(async () => (await playedCombatAudio(page, [file])).length, {
      timeout: 20000,
    })
    .toBe(1);
  await expect
    .poll(() => page.evaluate(() => (window as any).__arena.state.time), {
      timeout: 20000,
    })
    .toBeGreaterThan(4);
  const played = await playedCombatAudio(page, [file]);
  expect(played).toHaveLength(1);
  expect(played[0].path).toBe(file);
  expect(played[0].volume).toBeCloseTo(0.245);
  expect(played[0].time).toBeGreaterThan(2);
  expect(played[0].time).toBeLessThan(4);
  const chargedHit = "/assets/audio/prince_charge_hit_01.ogg";
  await expect
    .poll(async () => (await playedCombatAudio(page, [chargedHit])).length, {
      timeout: 40000,
    })
    .toBe(1);
  const hits = await playedCombatAudio(page, [chargedHit]);
  expect(hits[0].volume).toBeCloseTo(0.28);
  expect(hits[0].time).toBeGreaterThan(8);
  expect(hits[0].time).toBeLessThan(10);
  await expect
    .poll(() => page.evaluate(() => (window as any).__arena.state.time), {
      timeout: 20000,
    })
    .toBeGreaterThan(11);
  expect(await playedCombatAudio(page, [chargedHit])).toHaveLength(1);
});

test("Prince charge voice survives slow browser frames", async ({ page }) => {
  test.setTimeout(150000);
  await observeCombatAudio(page);
  await page.addInitScript(
    (saved) => {
      localStorage.setItem("browser-royale.profile.v1", JSON.stringify(saved));
      window.requestAnimationFrame = (callback) =>
        window.setTimeout(() => callback(performance.now()), 700);
      window.cancelAnimationFrame = (handle) => window.clearTimeout(handle);
    },
    {
      version: 1,
      sound: true,
      music: false,
      seenTutorial: true,
      battles: 1,
      history: [
        {
          id: 1,
          date: "2026-10-23T00:00:00.000Z",
          mode: replay.mode,
          winner: "blue",
          crowns: [1, 0],
          replay,
        },
      ],
    },
  );
  await page.goto("/");
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__arena?.state.loadedEffects),
      { timeout: 60000 },
    )
    .toBe(expectedEffects);
  await page.getByRole("button", { name: "Battle log", exact: true }).click();
  await page.locator('[data-replay="0"]').click();
  const file = "/assets/audio/rider_charge_03.ogg";
  await expect
    .poll(async () => (await playedCombatAudio(page, [file])).length, {
      timeout: 60000,
    })
    .toBe(1);
  await expect
    .poll(() => page.evaluate(() => (window as any).__arena.state.time), {
      timeout: 20000,
    })
    .toBeGreaterThan(4);
  expect(await playedCombatAudio(page, [file])).toHaveLength(1);
});
