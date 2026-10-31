import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import {
  CARD_MAP,
  PRESETS,
  STARTER_DECK,
  type CardId,
} from "../../src/game/cards";
import type { Profile } from "../../src/game/profile";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const initial: Profile = {
  version: 1,
  name: "Timing Learner",
  trophies: 321,
  best: 400,
  gold: 4321,
  wins: 4,
  battles: 12,
  crowns: 15,
  chests: ["gold"],
  deck: [...STARTER_DECK],
  decks: [[...STARTER_DECK], [...PRESETS[1].deck], [...PRESETS[2].deck]],
  activeDeck: 0,
  sound: false,
  music: true,
  emotesMuted: false,
  seenTutorial: true,
  history: [],
};
let rules: typeof import("../../src/game/engine");
test.beforeAll(async ({}, info) => {
  const file = info.outputPath("practice-speed-rules.mjs");
  await build({
    stdin: {
      contents: 'export { Battle, STEP } from "./src/game/engine.ts";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: file,
  });
  rules = await import(pathToFileURL(file).href);
});
const state = (page: Page) =>
  page.evaluate(() => (window as any).__arena.state);
const saved = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
async function deploy(page: Page) {
  const current = await state(page);
  const slot = current.hand.findIndex(
    (id: CardId) =>
      CARD_MAP[id].kind === "troop" && CARD_MAP[id].cost <= current.elixir,
  );
  expect(slot).toBeGreaterThanOrEqual(0);
  await page.mouse.move(0, 0);
  await page.keyboard.press(String(slot + 1));
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await state(page)).actions)
    .toBeGreaterThan(current.actions);
}

test("practice speed follows pauses, inspection and retries while recorded match time and other modes retain their rates", async ({
  page,
}, info) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(
    ({ key, initial }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify(initial));
      Math.random = () => 0;
    },
    { key, initial },
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
  const before = await saved(page);
  await page.locator(".mode-select").click();
  await page
    .getByRole("button", { name: "Choose a practice opponent", exact: true })
    .click();
  await page.locator("#practice-pace").selectOption("training");
  await page.locator("#start-practice").click();
  await expect
    .poll(async () => (await state(page)).intro.blocking, { timeout: 15000 })
    .toBe(false);
  expect((await state(page)).speed).toBe(1);
  const caption = page.locator(".match-bottom .competitor div > span");
  await expect(caption).toHaveText("Practice · 1× speed");
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  const speed = page.getByRole("combobox", {
    name: "Practice speed",
    exact: true,
  });
  await expect(speed).toHaveValue("1");
  expect((await speed.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const frozen = (await state(page)).time;
  await speed.selectOption("0.5");
  expect((await state(page)).speed).toBe(0.5);
  expect((await state(page)).music.rate).toBe(0.5);
  await page
    .getByRole("button", { name: "Inspect battle deck", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Back to pause menu", exact: true })
    .click();
  await expect(speed).toHaveValue("0.5");
  expect((await state(page)).time).toBe(frozen);
  await page.screenshot({
    path: info.outputPath("practice-slow-motion-menu.png"),
    animations: "disabled",
  });
  const resume = page.getByRole("button", {
    name: "Resume battle",
    exact: true,
  });
  if (info.project.name === "desktop") await resume.press("Enter");
  else await resume.tap();
  await expect(caption).toHaveText("Practice · 0.5× speed");
  await expect
    .poll(async () => (await state(page)).time)
    .toBeGreaterThan(frozen + 0.25);
  await deploy(page);
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  await speed.selectOption("2");
  expect((await state(page)).music.rate).toBe(2);
  await page
    .getByRole("button", { name: "Restart practice", exact: true })
    .click();
  expect((await state(page)).speed).toBe(2);
  expect((await state(page)).actions).toBe(0);
  expect(await saved(page)).toEqual(before);
  await expect
    .poll(async () => (await state(page)).intro.blocking, { timeout: 15000 })
    .toBe(false);
  await deploy(page);
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  const completed = await state(page);
  await page.getByRole("button", { name: "Leave battle", exact: true }).click();
  const again = page.getByRole("button", {
    name: "Practice again",
    exact: true,
  });
  await expect(again).toBeVisible({ timeout: 30000 });
  const after = await saved(page);
  expect(after.history).toHaveLength(1);
  expect(after.battles).toBe(before.battles + 1);
  expect(after.gold).toBe(before.gold);
  expect(after.trophies).toBe(before.trophies);
  expect(after.chests).toEqual(before.chests);
  expect(after.decks).toEqual(before.decks);
  const replay = after.history[0].replay;
  expect(replay.duration).toBe(Math.round(completed.time / rules.STEP));
  const rebuilt = new rules.Battle({ replay });
  while (rebuilt.tick < replay.duration && !rebuilt.winner) rebuilt.step();
  expect(rebuilt.time).toBeCloseTo(completed.time, 9);
  expect(rebuilt.players.blue.hand).toEqual(completed.hand);
  expect(rebuilt.players.blue.elixir).toBeCloseTo(completed.elixir, 9);
  expect(rebuilt.entities.filter((e) => e.kind === "troop")).toHaveLength(
    completed.troops,
  );
  await again.click();
  expect((await state(page)).speed).toBe(2);
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  await expect(speed).toHaveValue("2");
  await page.getByRole("button", { name: "Leave battle", exact: true }).click();
  await page.getByRole("button", { name: "Watch replay", exact: true }).click();
  expect((await state(page)).speed).toBe(1);
  expect((await state(page)).music.rate).toBe(1);
  await expect(caption).toHaveText("Replay");
  await page.locator("#replay-exit").click();
  expect((await state(page)).speed).toBe(1);
  await page.locator("#battle-button").click();
  expect((await state(page)).speed).toBe(1);
  await expect(caption).toHaveText("Browser kingdom");
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  await expect(speed).toHaveCount(0);
  expect(errors).toEqual([]);
});
