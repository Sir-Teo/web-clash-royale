import { test, expect, type Page, type Locator } from "@playwright/test";
import {
  CARD_MAP,
  PRESETS,
  STARTER_DECK,
  type CardId,
} from "../../src/game/cards";
import { SOLO_OPPONENTS } from "../../src/game/opponents";
import { expectedCards } from "./native-assets";

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
  seenTutorial: true,
  deck: PRESETS[2].deck,
  decks: [STARTER_DECK, PRESETS[1].deck, PRESETS[2].deck],
  activeDeck: 2,
  history: [],
};
const state = (page: Page) =>
  page.evaluate(() => (window as any).__arena?.state);
const saved = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
const deck = (root: Locator) =>
  root
    .locator("[data-practice-card]")
    .evaluateAll((cards) =>
      cards.map((card) => (card as HTMLElement).dataset.nativeCard),
    );
const choose = (page: Page) =>
  page.getByRole("combobox", { name: "Practice opponent", exact: true });
const chooseDeck = (page: Page) =>
  page.getByRole("combobox", { name: "Your saved deck", exact: true });
async function open(page: Page) {
  await page.locator(".mode-select").click();
  await page
    .getByRole("button", { name: "Choose a practice opponent", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Choose a practice opponent",
      exact: true,
    }),
  ).toBeVisible();
}
async function finish(page: Page) {
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  await page.getByRole("button", { name: "Leave battle", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Practice again", exact: true }),
  ).toBeVisible({ timeout: 20000 });
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ key, initial }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify(initial));
    },
    { key, initial },
  );
  await page.goto("/");
  await expect
    .poll(async () => (await state(page))?.loadedCards, { timeout: 60000 })
    .toBe(expectedCards);
});

test("previews all seventeen decks and returns from card inspection with the same selection", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const before = await saved(page);
  await open(page);
  await expect(chooseDeck(page)).toHaveValue(String(before.activeDeck));
  await expect(chooseDeck(page).locator("option")).toHaveCount(3);
  for (let slot = 0; slot < before.decks.length; slot++) {
    await chooseDeck(page).focus();
    await chooseDeck(page).selectOption(String(slot));
    await expect(chooseDeck(page)).toBeFocused();
    expect(await deck(page.locator('[data-practice-side="yours"]'))).toEqual(
      before.decks[slot],
    );
    const average =
      before.decks[slot].reduce(
        (sum: number, id: CardId) => sum + CARD_MAP[id].cost,
        0,
      ) / 8;
    await expect(
      page.locator('[data-practice-side="yours"] .match-deck-heading > span'),
    ).toContainText(`${average.toFixed(1)} average`);
  }
  await chooseDeck(page).selectOption("0");
  await expect(choose(page).locator("option")).toHaveCount(
    SOLO_OPPONENTS.length,
  );
  await choose(page).focus();
  for (const [index, opponent] of SOLO_OPPONENTS.entries()) {
    await choose(page).selectOption(String(index));
    await expect(choose(page)).toBeFocused();
    await expect(
      page.locator('[data-practice-side="opponent"] .match-deck-heading p'),
    ).toHaveText(opponent.name);
    expect(await deck(page.locator('[data-practice-side="opponent"]'))).toEqual(
      opponent.deck,
    );
    expect(await deck(page.locator('[data-practice-side="yours"]'))).toEqual(
      before.decks[0],
    );
    const average =
      opponent.deck.reduce((sum, id) => sum + CARD_MAP[id].cost, 0) / 8;
    await expect(
      page.locator(
        '[data-practice-side="opponent"] .match-deck-heading > span',
      ),
    ).toContainText(`${average.toFixed(1)} average`);
  }
  await choose(page).selectOption("8");
  await page.screenshot({
    path: info.outputPath("practice-opponent-picker.png"),
    animations: "disabled",
  });
  for (const side of ["yours", "opponent"]) {
    const card = page.locator(`[data-practice-card="${side}-0"]`);
    const id = (await card.getAttribute("data-native-card")) as CardId;
    await card.scrollIntoViewIfNeeded();
    const scroll = await page
      .getByRole("dialog")
      .evaluate((element) => element.scrollTop);
    await card.click();
    await expect(
      page.getByRole("heading", { name: CARD_MAP[id].name, exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Back to practice decks", exact: true })
      .click();
    await expect(card).toBeFocused();
    await expect(choose(page)).toHaveValue("8");
    await expect(chooseDeck(page)).toHaveValue("0");
    expect(
      await page.getByRole("dialog").evaluate((element) => element.scrollTop),
    ).toBeCloseTo(scroll, 0);
  }
  await page
    .getByRole("button", { name: "Back to battle modes", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Choose a practice opponent",
      exact: true,
    }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Choose a practice opponent", exact: true })
    .click();
  await expect(choose(page)).toHaveValue("8");
  await expect(chooseDeck(page)).toHaveValue("0");
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(page.locator(".mode-select")).toBeFocused();
  expect(await saved(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test("starts the selected practice, saves reward-free replays and repeats the same opponent", async ({
  page,
}) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.locator(".mode-select").click();
  await page.locator('[data-mode="double"]').click();
  const before = await saved(page);
  await open(page);
  await choose(page).selectOption("1");
  await chooseDeck(page).selectOption("0");
  const start = page.getByRole("button", {
    name: "Start practice",
    exact: true,
  });
  await expect(start).toHaveAttribute(
    "aria-describedby",
    /(?:^| )practice-opponent-note(?: |$)/,
  );
  await start.scrollIntoViewIfNeeded();
  if (await page.evaluate(() => navigator.maxTouchPoints > 0))
    await start.tap();
  else {
    await start.focus();
    await start.press("Enter");
  }
  for (let round = 0; round < 2; round++) {
    const opponent = SOLO_OPPONENTS[1];
    await expect(page.locator("#battle-intro")).toHaveAttribute(
      "data-clip",
      "pvp_battle_start_training",
    );
    await expect(page.locator(".competitor.enemy b")).toHaveText(opponent.name);
    await expect(page.locator(".competitor.enemy div > span")).toHaveText(
      `${opponent.style} · Training camp · Practice AI`,
    );
    expect((await state(page)).enemyDeck).toEqual(opponent.deck);
    expect(
      (await state(page)).hand.every((id: CardId) =>
        before.decks[0].includes(id),
      ),
    ).toBe(true);
    await expect
      .poll(async () => (await state(page)).actions, { timeout: 30000 })
      .toBeGreaterThan(0);
    await finish(page);
    await expect(page.locator(".practice-result-note")).toHaveText(
      "Practice AI · no trophies or rewards",
    );
    const after = await saved(page);
    for (const field of [
      "gold",
      "trophies",
      "best",
      "chests",
      "deck",
      "decks",
      "activeDeck",
      "wins",
      "crowns",
    ])
      expect(after[field]).toEqual(before[field]);
    expect(after.battles).toBe(before.battles + round + 1);
    expect(after.history[0]).toMatchObject({
      mode: "training",
      opponent: opponent.name,
      opponentType: "ai",
      playerName: before.name,
      replay: {
        version: 56,
        rulesFamily: "origin",
        mode: "training",
        deck: before.decks[0],
        enemyDeck: opponent.deck,
      },
    });
    expect(
      after.history[0].replay.actions.some(
        (action: any) => action.team === "red",
      ),
    ).toBe(true);
    if (round === 0)
      await page
        .getByRole("button", { name: "Practice again", exact: true })
        .click();
  }
  await page.getByRole("button", { name: "Watch replay", exact: true }).click();
  expect((await state(page)).enemyDeck).toEqual(SOLO_OPPONENTS[1].deck);
  expect(
    (await state(page)).hand.every((id: CardId) =>
      before.decks[0].includes(id),
    ),
  ).toBe(true);
  await page.locator("#replay-seek").fill("100");
  await expect(page.locator("#replay-play")).toHaveAttribute(
    "aria-label",
    "Restart replay",
  );
  await page.locator("#replay-exit").click();
  await expect(page.locator("#mode-name")).toHaveText("Double elixir");
  await open(page);
  await expect(chooseDeck(page)).toHaveValue(String(before.activeDeck));
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.locator("#battle-button").click();
  await expect(page.locator(".competitor.enemy div > span")).toContainText(
    "AI opponent",
  );
  await expect(page.locator("#battle-intro")).toHaveAttribute(
    "data-clip",
    "pvp_battle_start",
  );
  expect(
    (await state(page)).hand.every((id: CardId) => before.deck.includes(id)),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("finds a matchup by cards without losing deck choices or starting a hidden opponent", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const before = await saved(page);
  await open(page);
  const search = page.getByRole("searchbox", { name: "Find a matchup" });
  const count = page.locator("#practice-search-count");
  const clear = page.getByRole("button", { name: "Clear search", exact: true });
  const pace = page.getByRole("combobox", {
    name: "Practice pace",
    exact: true,
  });
  const start = page.getByRole("button", {
    name: "Start practice",
    exact: true,
  });
  await expect(count).toHaveText("17 of 17 opponents");
  await expect(clear).toBeHidden();
  await chooseDeck(page).selectOption("1");
  await pace.selectOption("double");
  await choose(page).selectOption("16");
  for (const side of ["yours", "opponent"])
    await page.locator(`[data-practice-card="${side}-0"]`).evaluate((card) => {
      card.setAttribute("data-retained", "yes");
    });
  await search.focus();
  await search.pressSequentially("sparky zap");
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("sparky zap");
  await expect(choose(page)).toHaveValue("16");
  await expect(choose(page).locator("option")).toHaveCount(1);
  await expect(count).toHaveText("1 of 17 opponents");
  for (const side of ["yours", "opponent"])
    await expect(
      page.locator(`[data-practice-card="${side}-0"]`),
    ).toHaveAttribute("data-retained", "yes");
  await expect(chooseDeck(page)).toHaveValue("1");
  await expect(pace).toHaveValue("double");
  await search.fill("sparky graveyard");
  await expect(count).toContainText("No opponents match");
  await expect(choose(page)).toBeDisabled();
  await expect(start).toBeDisabled();
  await expect(page.locator('[data-practice-side="opponent"]')).toHaveCount(0);
  await expect(page.locator('[data-practice-card="yours-0"]')).toHaveAttribute(
    "data-retained",
    "yes",
  );
  await chooseDeck(page).selectOption("2");
  await expect(search).toHaveValue("sparky graveyard");
  await expect(start).toBeDisabled();
  await expect(pace).toHaveValue("double");
  await clear.click();
  await expect(search).toBeFocused();
  await expect(choose(page)).toHaveValue("16");
  await expect(count).toHaveText("17 of 17 opponents");
  await expect(start).toBeEnabled();
  await search.fill('<script>alert("matchup")</script>');
  await expect(start).toBeDisabled();
  await search.fill("SÍEGE x-bow");
  await expect(choose(page)).toHaveValue("9");
  expect(await deck(page.locator('[data-practice-side="opponent"]'))).toEqual(
    SOLO_OPPONENTS[9].deck,
  );
  const card = page.locator('[data-practice-card="opponent-0"]');
  await card.click();
  await page
    .getByRole("button", { name: "Back to practice decks", exact: true })
    .click();
  await expect(card).toBeFocused();
  await expect(search).toHaveValue("SÍEGE x-bow");
  await expect(chooseDeck(page)).toHaveValue("2");
  await expect(pace).toHaveValue("double");
  await page
    .getByRole("button", { name: "Back to battle modes", exact: true })
    .click();
  await page.locator("#choose-practice-opponent").click();
  await expect(search).toHaveValue("SÍEGE x-bow");
  await expect(choose(page)).toHaveValue("9");
  expect(await saved(page)).toEqual(before);
  await search.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath("practice-search.png"),
    animations: "disabled",
  });
  await start.click();
  await expect(page.locator(".competitor.enemy b")).toHaveText(
    SOLO_OPPONENTS[9].name,
  );
  expect((await state(page)).enemyDeck).toEqual(SOLO_OPPONENTS[9].deck);
  expect(
    (await state(page)).hand.every((id: CardId) =>
      before.decks[2].includes(id),
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("keeps practice controls and deck cards usable on narrow and rotated screens", async ({
  page,
}, info) => {
  await open(page);
  await choose(page).selectOption("12");
  for (const viewport of [
    { width: 320, height: 740 },
    { width: 844, height: 390 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect
      .poll(() =>
        page
          .getByRole("dialog")
          .evaluate(
            (element) => element.scrollWidth <= element.clientWidth + 1,
          ),
      )
      .toBe(true);
    for (const selector of [
      "#practice-opponent",
      "#practice-pace",
      "#practice-deck",
      "#practice-search",
      "#start-practice",
      "[data-practice-card]",
    ]) {
      for (const control of await page.locator(selector).all()) {
        const bounds = (await control.boundingBox())!;
        expect(bounds.width).toBeGreaterThanOrEqual(44);
        expect(bounds.height).toBeGreaterThanOrEqual(44);
      }
    }
  }
  await page.screenshot({
    path: info.outputPath("practice-opponent-phone.png"),
    animations: "disabled",
  });
});
