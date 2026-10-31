import { test, expect } from "@playwright/test";
import {
  CARD_MAP,
  PRESETS,
  STARTER_DECK,
  type CardId,
} from "../../src/game/cards";
import { SOLO_OPPONENTS } from "../../src/game/opponents";
import { encodeDeckCode } from "../../src/game/deck-code";
import type { Profile } from "../../src/game/profile";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const custom: CardId[] = [
  "rocket",
  "rage",
  "hog-rider",
  "musketeer",
  "cannon",
  "skeletons",
  "goblins",
  "zap",
];
const initial: Profile = {
  version: 1,
  name: "Matchup Captain",
  trophies: 321,
  best: 400,
  gold: 4567,
  wins: 4,
  battles: 12,
  crowns: 15,
  chests: ["gold"],
  deck: [...PRESETS[2].deck],
  decks: [[...STARTER_DECK], [...PRESETS[1].deck], [...PRESETS[2].deck]],
  activeDeck: 2,
  sound: false,
  music: false,
  emotesMuted: false,
  seenTutorial: true,
  history: [],
};

test("changing a paused practice discards its attempt and retains the temporary matchup for editing", async ({
  page,
}, info) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
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
  const state = () => page.evaluate(() => (window as any).__arena?.state);
  const saved = () =>
    page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
  await expect
    .poll(async () => (await state())?.loadedCards, { timeout: 60000 })
    .toBe(expectedCards);
  await page
    .getByRole("button", { name: `Cards ${expectedCards}`, exact: true })
    .click();
  await page.getByRole("button", { name: "Deck codes", exact: true }).click();
  await page
    .getByLabel("PASTE A SHARED DECK CODE", { exact: true })
    .fill(encodeDeckCode(custom));
  await page.getByRole("button", { name: "Preview deck", exact: true }).click();
  await page
    .getByRole("button", { name: "Try this deck in practice", exact: true })
    .click();
  await page.locator("#practice-opponent").selectOption("8");
  await page.locator("#practice-pace").selectOption("double");
  await page.locator("#start-practice").click();
  await expect
    .poll(async () => (await state()).intro.blocking, { timeout: 30000 })
    .toBe(false);
  const opening = await state();
  const slot = opening.hand.findIndex(
    (id: CardId) =>
      CARD_MAP[id].kind === "troop" && CARD_MAP[id].cost <= opening.elixir,
  );
  expect(slot).toBeGreaterThanOrEqual(0);
  await page.mouse.move(0, 0);
  await page.keyboard.press(String(slot + 1));
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await state()).actions).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  await page.locator("#practice-opening").selectOption("fresh");
  const change = page.getByRole("button", {
    name: "Change practice matchup",
    exact: true,
  });
  await expect(change).toBeVisible();
  expect((await change.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(page.locator("#practice-restart-note")).toContainText(
    "This attempt won’t be saved.",
  );
  await page.screenshot({
    path: info.outputPath("change-paused-matchup.png"),
    animations: "disabled",
  });
  if (info.project.name === "desktop") {
    await change.focus();
    await change.press("Enter");
  } else await change.tap();
  await expect(page.locator("#modal-title")).toHaveText(
    "Choose a practice opponent",
  );
  await expect(page.locator("#practice-deck")).toHaveValue("previous");
  await expect(page.locator("#practice-opponent")).toHaveValue("8");
  await expect(page.locator("#practice-pace")).toHaveValue("double");
  await expect(page.locator("#practice-back")).toHaveText(
    "Back to battle modes",
  );
  expect(
    await page
      .locator('[data-practice-card^="yours-"]')
      .evaluateAll((cards) =>
        cards.map((card) => (card as HTMLElement).dataset.nativeCard),
      ),
  ).toEqual(custom);
  expect(await saved()).toEqual(initial);
  expect(await state()).toMatchObject({
    screen: "lobby",
    actions: 0,
    paused: false,
  });
  await page.locator("#practice-deck").selectOption("curated:3");
  await page.locator("#practice-opponent").selectOption("9");
  await page.locator("#practice-pace").selectOption("classic");
  await page.locator("#start-practice").click();
  expect(await state()).toMatchObject({
    screen: "battle",
    actions: 0,
    enemyDeck: SOLO_OPPONENTS[9].deck,
  });
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  await expect(page.locator("#practice-opening")).toHaveValue("fresh");
  await page.getByRole("button", { name: "Leave battle", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Practice again", exact: true }),
  ).toBeVisible({ timeout: 20000 });
  const after = await saved();
  expect(after.history).toHaveLength(1);
  expect(after.history[0]).toMatchObject({
    practice: true,
    mode: "classic",
    opponent: SOLO_OPPONENTS[9].name,
  });
  expect(after.history[0].replay.deck).toEqual(SOLO_OPPONENTS[3].deck);
  expect(after.history[0].replay.enemyDeck).toEqual(SOLO_OPPONENTS[9].deck);
  expect(after.history[0].replay.actions).toEqual([]);
  expect({ ...after, battles: initial.battles, history: [] }).toEqual(initial);
  expect(after.battles).toBe(initial.battles + 1);
  expect(errors).toEqual([]);
});
