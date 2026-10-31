import { test, expect, type Page } from "@playwright/test";
import { CARD_MAP, PRESETS, STARTER_DECK } from "../../src/game/cards";
import { SOLO_OPPONENTS } from "../../src/game/opponents";
import type { Profile } from "../../src/game/profile";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const initial: Profile = {
  version: 1,
  name: "Practice Scout",
  trophies: 321,
  best: 400,
  gold: 4567,
  wins: 4,
  battles: 12,
  crowns: 15,
  chests: ["gold"],
  history: [],
  deck: [...PRESETS[2].deck],
  decks: [[...STARTER_DECK], [...PRESETS[1].deck], [...PRESETS[2].deck]],
  activeDeck: 2,
  sound: false,
  music: false,
  emotesMuted: false,
  seenTutorial: true,
};
const state = (page: Page) =>
  page.evaluate(() => (window as any).__arena?.state);
const ids = (page: Page) =>
  page
    .locator("[data-battle-card]")
    .evaluateAll((cards) =>
      cards.map((card) => (card as HTMLElement).dataset.nativeCard),
    );

test("inspects both captured practice decks while paused and retains the chosen side through card and graphics recovery", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(
    ({ key, initial }) => {
      localStorage.setItem(key, JSON.stringify(initial));
      Math.random = () => 0;
    },
    { key, initial },
  );
  if (info.project.name !== "desktop")
    await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");
  await expect
    .poll(async () => (await state(page))?.loadedCards, { timeout: 60000 })
    .toBe(expectedCards);
  await page.locator(".mode-select").click();
  await page
    .getByRole("button", { name: "Choose a practice opponent", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Your practice deck", exact: true })
    .selectOption("curated:7");
  await page
    .getByRole("combobox", { name: "Practice opponent", exact: true })
    .selectOption("19");
  await page
    .getByRole("button", { name: "Start practice", exact: true })
    .click();
  await expect
    .poll(async () => (await state(page)).intro.blocking, { timeout: 20000 })
    .toBe(false);
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  const held = await state(page);
  await page
    .getByRole("button", { name: "Inspect battle deck", exact: true })
    .click();
  const side = page.getByRole("combobox", {
    name: "Deck to inspect",
    exact: true,
  });
  await expect(side).toHaveValue("yours");
  expect(await ids(page)).toEqual(SOLO_OPPONENTS[7].deck);
  await side.focus();
  await side.selectOption("opponent");
  await expect(side).toBeFocused();
  await expect(page.locator("#modal-title")).toHaveText(
    "Opponent practice deck",
  );
  await expect(page.locator(".match-deck-heading h3")).toHaveText(
    "Battle deck 3",
  );
  expect(await ids(page)).toEqual(initial.deck);
  await expect(page.locator(".match-deck-heading > span")).toContainText(
    `${(initial.deck.reduce((sum, id) => sum + CARD_MAP[id].cost, 0) / 8).toFixed(1)} average`,
  );
  expect(
    await page
      .getByRole("dialog")
      .evaluate((e) => e.scrollWidth <= e.clientWidth),
  ).toBe(true);
  await side.scrollIntoViewIfNeeded();
  expect((await side.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({
    path: info.outputPath("practice-opponent-inspection.png"),
    animations: "disabled",
  });
  const card = page.locator('[data-battle-card="0"]');
  await card.evaluate((e) => {
    (window as any).__practiceInspectedCard = e;
  });
  if (info.project.name === "desktop") await card.click();
  else await card.tap();
  await expect(page.locator("#modal-title")).toHaveText(
    CARD_MAP[initial.deck[0]].name,
  );
  await page
    .getByRole("button", { name: "Back to battle deck", exact: true })
    .click();
  await expect(card).toBeFocused();
  expect(
    await card.evaluate((e) => e === (window as any).__practiceInspectedCard),
  ).toBe(true);
  await expect(side).toHaveValue("opponent");
  await side.focus();
  await side.selectOption("yours");
  await expect(side).toBeFocused();
  expect(await ids(page)).toEqual(SOLO_OPPONENTS[7].deck);
  await expect(page.locator("#modal-title")).toHaveText("Your battle deck");
  await side.selectOption("opponent");
  expect((await state(page)).time).toBe(held.time);
  expect((await state(page)).actions).toBe(held.actions);
  await page
    .locator("#arena-canvas canvas")
    .evaluate((canvas: HTMLCanvasElement) => {
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      const extension = gl!.getExtension("WEBGL_lose_context")!;
      (window as any).__practiceDeckContext = extension;
      extension.loseContext();
    });
  await expect
    .poll(async () => (await state(page)).graphicsAvailable)
    .toBe(false);
  await card.click();
  await page
    .getByRole("button", { name: "Back to battle deck", exact: true })
    .click();
  await expect(side).toHaveValue("opponent");
  await expect(card).toBeFocused();
  await page
    .getByRole("button", { name: "Back to pause menu", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Resume battle", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() =>
    (window as any).__practiceDeckContext.restoreContext(),
  );
  await expect
    .poll(async () => (await state(page)).graphicsAvailable)
    .toBe(true);
  expect((await state(page)).paused).toBe(true);
  expect((await state(page)).time).toBe(held.time);
  expect(
    await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key),
  ).toEqual(initial);
  await page
    .getByRole("button", { name: "Resume battle", exact: true })
    .click();
  await expect
    .poll(async () => (await state(page)).time)
    .toBeGreaterThan(held.time);
  expect(errors).toEqual([]);
});
