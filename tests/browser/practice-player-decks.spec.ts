import { test, expect, type Page } from "@playwright/test";
import { PRESETS, STARTER_DECK } from "../../src/game/cards";
import { SOLO_OPPONENTS } from "../../src/game/opponents";
import type { Profile } from "../../src/game/profile";
import { expectedCards } from "./native-assets";
import { inspectDeckCode } from "./inspect-deck-code";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const initial: Profile = {
  version: 1,
  name: "Curated Captain",
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
const saved = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
const own = (page: Page) =>
  page.getByRole("combobox", { name: "Your practice deck", exact: true });
const enemy = (page: Page) =>
  page.getByRole("combobox", { name: "Practice opponent", exact: true });
const pace = (page: Page) =>
  page.getByRole("combobox", { name: "Practice pace", exact: true });
test.beforeEach(async ({ page }, info) => {
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
});
async function finish(page: Page) {
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  await page.getByRole("button", { name: "Leave battle", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Practice again", exact: true }),
  ).toBeVisible({ timeout: 20000 });
}

test("previews all curated player decks with stable opponent choices and read-only inspection", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const before = await saved(page);
  await expect(own(page)).toHaveValue(String(initial.activeDeck));
  await expect(
    own(page).locator('optgroup[label="Your saved decks"] option'),
  ).toHaveCount(3);
  await expect(
    own(page).locator('optgroup[label="Curated decks"] option'),
  ).toHaveCount(SOLO_OPPONENTS.length);
  await enemy(page).selectOption("19");
  await pace(page).selectOption("double");
  await own(page).focus();
  for (const [index, opponent] of SOLO_OPPONENTS.entries()) {
    await own(page).selectOption(`curated:${index}`);
    await expect(own(page)).toBeFocused();
    expect(
      await page
        .locator('[data-practice-side="yours"] [data-practice-card]')
        .evaluateAll((cards) =>
          cards.map((card) => (card as HTMLElement).dataset.nativeCard),
        ),
    ).toEqual(opponent.deck);
    await expect(
      page.locator('[data-practice-side="yours"] .match-deck-heading p'),
    ).toHaveText(opponent.style);
    await expect(enemy(page)).toHaveValue("19");
    await expect(pace(page)).toHaveValue("double");
    expect(
      await page
        .getByRole("dialog")
        .evaluate((e) => e.scrollWidth <= e.clientWidth),
    ).toBe(true);
  }
  for (const side of ["yours", "opponent"] as const) {
    await inspectDeckCode(
      page,
      page.locator(`[data-share-deck-code="${side}"]`),
      side === "yours" ? SOLO_OPPONENTS[16].deck : initial.decks[2],
      "Back to practice setup",
    );
    await expect(own(page)).toHaveValue("curated:16");
    await expect(enemy(page)).toHaveValue("19");
    await expect(pace(page)).toHaveValue("double");
  }
  await enemy(page).selectOption("8");
  await inspectDeckCode(
    page,
    page.locator('[data-share-deck-code="opponent"]'),
    SOLO_OPPONENTS[8].deck,
    "Back to practice setup",
  );
  await enemy(page).selectOption("19");
  const card = page.locator('[data-practice-card="yours-0"]');
  if (info.project.name === "desktop") await card.click();
  else await card.tap();
  await page
    .getByRole("button", { name: "Back to practice decks", exact: true })
    .click();
  await expect(card).toBeFocused();
  await expect(own(page)).toHaveValue("curated:16");
  await expect(enemy(page)).toHaveValue("19");
  expect(await saved(page)).toEqual(before);
  await own(page).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath("curated-player-deck-choice.png"),
    animations: "disabled",
  });
});

test("pilots a temporary curated deck through inspection, restart, rematch and matchup changes", async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const chosen = SOLO_OPPONENTS[7];
  await own(page).selectOption("curated:7");
  await enemy(page).selectOption("19");
  await pace(page).selectOption("double");
  await page
    .getByRole("button", { name: "Start practice", exact: true })
    .click();
  expect(
    (await state(page)).hand.every((id: string) =>
      (chosen.deck as readonly string[]).includes(id),
    ),
  ).toBe(true);
  expect((await state(page)).enemyDeck).toEqual(initial.decks[2]);
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  await page
    .getByRole("button", { name: "Inspect battle deck", exact: true })
    .click();
  expect(
    await page
      .locator("[data-battle-card]")
      .evaluateAll((cards) =>
        cards.map((card) => (card as HTMLElement).dataset.nativeCard),
      ),
  ).toEqual(chosen.deck);
  await page
    .getByRole("button", { name: "Back to pause menu", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Restart practice", exact: true })
    .click();
  expect(
    (await state(page)).hand.every((id: string) =>
      (chosen.deck as readonly string[]).includes(id),
    ),
  ).toBe(true);
  expect(await saved(page)).toEqual(initial);
  await finish(page);
  await page
    .getByRole("button", { name: "Practice again", exact: true })
    .click();
  expect(
    (await state(page)).hand.every((id: string) =>
      (chosen.deck as readonly string[]).includes(id),
    ),
  ).toBe(true);
  await finish(page);
  await page
    .getByRole("button", { name: "Change practice matchup", exact: true })
    .click();
  await expect(own(page)).toHaveValue("curated:7");
  await expect(enemy(page)).toHaveValue("19");
  await expect(pace(page)).toHaveValue("double");
  await expect(page.locator("#practice-record")).toContainText(
    "0 wins · 2 losses · 0 draws",
  );
  const after = await saved(page);
  expect(after.history).toHaveLength(2);
  expect({ ...after, history: [], battles: initial.battles }).toEqual(initial);
  expect(after.battles).toBe(initial.battles + 2);
  for (const record of after.history) {
    expect(record).toMatchObject({
      practice: true,
      mode: "double",
      playerName: initial.name,
      opponent: "Battle deck 3",
    });
    expect(record.replay.deck).toEqual(chosen.deck);
    expect(record.replay.enemyDeck).toEqual(initial.decks[2]);
  }
  expect(errors).toEqual([]);
});
