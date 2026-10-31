import { test, expect, type Page } from "@playwright/test";
import { PRESETS, STARTER_DECK } from "../../src/game/cards";
import type { Profile } from "../../src/game/profile";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const initial: Profile = {
  version: 1,
  name: "Earlier Captain",
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
const saved = (page: Page): Promise<Profile> =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
const loaded = (page: Page) =>
  expect
    .poll(
      () => page.evaluate(() => (window as any).__arena?.state.loadedCards),
      { timeout: 60000 },
    )
    .toBe(expectedCards);
function moved(profile: Profile) {
  const next = structuredClone(profile);
  [next.deck[0], next.deck[1]] = [next.deck[1], next.deck[0]];
  next.decks[next.activeDeck] = [...next.deck];
  return next;
}
async function newerProgress(page: Page, switchDeck: boolean) {
  await page
    .getByRole("button", { name: "Battle settings", exact: true })
    .click();
  await page.locator("#player-name").fill("Newer Captain");
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  if (switchDeck) await page.locator('[data-deck="1"]').click();
  await page.locator('[data-chest="0"]').click();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.locator(".mode-select").click();
  await page
    .getByRole("button", { name: "Choose a practice opponent", exact: true })
    .click();
  await page.locator("#start-practice").click();
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  await page.getByRole("button", { name: "Leave battle", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Practice again", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  return saved(page);
}

test.beforeEach(async ({ page }, info) => {
  await page.addInitScript(
    ({ key, initial }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify(initial));
    },
    { key, initial },
  );
  if (info.project.name !== "desktop")
    await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");
  await loaded(page);
  await page
    .getByRole("button", { name: `Cards ${expectedCards}`, exact: true })
    .click();
});

for (const conflict of [false, true]) {
  test(`older builder ${conflict ? "Undo refreshes a changed saved deck without overwriting it" : "moves keep newer progress and retain owned Undo and Redo"}`, async ({
    page,
    context,
  }, info) => {
    test.setTimeout(240000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    if (conflict) {
      await page.locator('[data-edit-slot="0"]').click();
      await page.locator("#deck-move-later").click();
      await expect(page.locator("#deck-undo")).toBeEnabled();
      await page
        .getByRole("textbox", { name: "Search cards", exact: true })
        .fill("pekka");
    }
    const newer = await context.newPage();
    newer.on("pageerror", (error) => errors.push(error.message));
    if (info.project.name !== "desktop")
      await newer.setViewportSize({ width: 320, height: 740 });
    await newer.goto("/");
    await loaded(newer);
    await newer.bringToFront();
    const latest = await newerProgress(newer, conflict);
    expect(latest.history).toHaveLength(1);
    expect(latest).toMatchObject({
      name: "Newer Captain",
      gold: initial.gold + 350,
      battles: initial.battles + 1,
      chests: [],
    });
    const raw = await newer.evaluate((key) => localStorage.getItem(key), key);
    await page.bringToFront();
    if (conflict) {
      await page.locator("#deck-undo").click();
      await expect(page.locator("#deck-edit-status")).toHaveText(
        "Saved decks changed in another tab. Review your deck before editing.",
      );
      await expect(page.locator("#deck-undo")).toBeDisabled();
      await expect(page.locator('[data-edit-slot="0"]')).toBeFocused();
      await expect(
        page.getByRole("textbox", { name: "Search cards", exact: true }),
      ).toHaveValue("pekka");
      expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
        raw,
      );
      expect(
        await page
          .locator("[data-edit-slot]")
          .evaluateAll((cards) =>
            cards.map((card) => (card as HTMLElement).dataset.nativeCard),
          ),
      ).toEqual(latest.deck);
      await page.screenshot({
        path: info.outputPath("updated-builder-after-deck-conflict.png"),
        animations: "disabled",
      });
    }
    await page.locator('[data-edit-slot="0"]').click();
    await page.locator("#deck-move-later").click();
    const expected = moved(latest);
    expect(await saved(page)).toEqual(expected);
    await page.locator("#deck-undo").click();
    expect(await saved(page)).toEqual(latest);
    await page.locator("#deck-redo").click();
    expect(await saved(page)).toEqual(expected);
    await page.locator("#deck-done").click();
    await page.reload();
    await loaded(page);
    expect(await saved(page)).toEqual(expected);
    await expect(page.locator(".player-card .player-name")).toHaveText(
      "Newer Captain",
    );
    expect(errors).toEqual([]);
  });
}
