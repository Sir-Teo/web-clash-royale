import { test, expect } from "@playwright/test";
import {
  CARD_MAP,
  PRESETS,
  STARTER_DECK,
  type CardId,
} from "../../src/game/cards";
import { SOLO_OPPONENTS } from "../../src/game/opponents";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const initial = {
  version: 1,
  name: "Practice Captain",
  gold: 4567,
  trophies: 321,
  best: 400,
  wins: 4,
  battles: 12,
  crowns: 15,
  chests: ["gold"],
  sound: false,
  music: false,
  emotesMuted: false,
  seenTutorial: true,
  deck: PRESETS[2].deck,
  decks: [STARTER_DECK, PRESETS[1].deck, PRESETS[2].deck],
  activeDeck: 2,
  history: [],
};
test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ key, initial }) => {
      localStorage.setItem(key, JSON.stringify(initial));
      Math.random = () => 0;
    },
    { key, initial },
  );
  await page.goto("/");
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__arena?.state.loadedCards),
      { timeout: 60000 },
    )
    .toBe(expectedCards);
});

test("restarting practice keeps its decks and pace without saving abandoned attempts or rewards", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  if (info.project.name !== "desktop")
    await page.setViewportSize({ width: 320, height: 740 });
  const state = () => page.evaluate(() => (window as any).__arena.state);
  const saved = () =>
    page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
  await page.locator(".mode-select").click();
  await page
    .getByRole("button", { name: "Choose a practice opponent", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Your saved deck", exact: true })
    .selectOption("0");
  await page
    .getByRole("combobox", { name: "Practice opponent", exact: true })
    .selectOption("8");
  await page
    .getByRole("combobox", { name: "Practice pace", exact: true })
    .selectOption("double");
  await page
    .getByRole("button", { name: "Start practice", exact: true })
    .click();
  const opening = await state();
  await expect
    .poll(async () => (await state()).intro.blocking, { timeout: 15000 })
    .toBe(false);
  const beforePlay = await state();
  const slot = beforePlay.hand.findIndex(
    (id: CardId) =>
      CARD_MAP[id].kind === "troop" && CARD_MAP[id].cost <= beforePlay.elixir,
  );
  expect(slot).toBeGreaterThanOrEqual(0);
  await page.mouse.move(0, 0);
  await page.keyboard.press(String(slot + 1));
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await state()).actions).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  const restart = page.getByRole("button", {
    name: "Restart practice",
    exact: true,
  });
  await expect(restart).toBeVisible();
  await expect(page.locator("#practice-restart-note")).toContainText(
    "This attempt won’t be saved.",
  );
  await page.screenshot({
    path: info.outputPath("practice-restart-menu.png"),
    animations: "disabled",
  });
  const canvas = page.locator("#arena-canvas canvas");
  await canvas.evaluate((canvas: HTMLCanvasElement) => {
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    const extension = gl!.getExtension("WEBGL_lose_context")!;
    (window as any).__practiceContext = extension;
    extension.loseContext();
  });
  await expect(restart).toBeDisabled();
  await expect(page.locator("#resume-button")).toBeDisabled();
  await expect(page.locator("#surrender-button")).toBeEnabled();
  await page.evaluate(() => (window as any).__practiceContext.restoreContext());
  await expect
    .poll(async () => (await state()).graphicsAvailable, { timeout: 60000 })
    .toBe(true);
  await expect(restart).toBeEnabled();
  expect((await state()).paused).toBe(true);
  if (info.project.name === "desktop") {
    await restart.focus();
    await restart.press("Enter");
  } else await restart.tap();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await state()).toMatchObject({
    time: 0,
    paused: false,
    actions: 0,
    selected: -1,
    troops: 0,
    winner: null,
    hand: opening.hand,
    enemyDeck: SOLO_OPPONENTS[8].deck,
  });
  await expect(page.locator(".competitor.enemy div > span")).toContainText(
    "Double elixir · Practice AI",
  );
  expect(await saved()).toEqual(initial);
  // A second immediate restart still uses the captured practice loadout.
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  await restart.click();
  expect(await state()).toMatchObject({
    time: 0,
    actions: 0,
    hand: opening.hand,
    enemyDeck: SOLO_OPPONENTS[8].deck,
  });
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  await page.getByRole("button", { name: "Leave battle", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Practice again", exact: true }),
  ).toBeVisible({ timeout: 20000 });
  const after = await saved();
  expect(after.history).toHaveLength(1);
  expect(after.history[0]).toMatchObject({
    practice: true,
    mode: "double",
    opponent: SOLO_OPPONENTS[8].name,
  });
  expect(after.history[0].replay.deck).toEqual(initial.decks[0]);
  expect(after.history[0].replay.enemyDeck).toEqual(SOLO_OPPONENTS[8].deck);
  expect(after.history[0].replay.actions).toEqual([]);
  expect({ ...after, history: [], battles: initial.battles }).toEqual(initial);
  expect(after.battles).toBe(initial.battles + 1);
  expect(errors).toEqual([]);
});

test("ordinary AI battles keep their existing pause and leave actions", async ({
  page,
}) => {
  await page.locator("#battle-button").click();
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Restart practice", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("#practice-restart-note")).toHaveCount(0);
  await expect(page.locator("#resume-button")).toBeEnabled();
  await expect(page.locator("#surrender-button")).toBeEnabled();
  await page.locator("#resume-button").click();
  expect(await page.evaluate(() => (window as any).__arena.state.paused)).toBe(
    false,
  );
});
