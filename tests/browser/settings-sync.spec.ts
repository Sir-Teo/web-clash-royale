import { test, expect, type Page } from "@playwright/test";
import { PRESETS, STARTER_DECK } from "../../src/game/cards";
import type { Profile } from "../../src/game/profile";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const initial: Profile = {
  version: 1,
  name: "Original King",
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
const incoming: Profile = {
  ...initial,
  name: "Synced Captain",
  gold: 4917,
  chests: [],
  deck: [...PRESETS[1].deck],
  activeDeck: 1,
  sound: true,
  music: true,
  emotesMuted: true,
};
const raw = JSON.stringify(incoming, null, 2);
const loaded = (page: Page) =>
  expect
    .poll(
      () => page.evaluate(() => (window as any).__arena?.state.loadedCards),
      { timeout: 60000 },
    )
    .toBe(expectedCards);
async function changed(page: Page) {
  await expect(page.locator(".player-card .player-name")).toHaveText(
    incoming.name,
  );
  await expect(page.locator("#gold")).toHaveText("4,917");
  await expect(page.locator('#deck-tabs [data-deck="1"]')).toHaveClass(
    /active/,
  );
  await expect(page.locator("[data-chest]")).toHaveCount(0);
  expect(
    await page
      .locator("#deck-preview [data-card-info]")
      .evaluateAll((cards) =>
        cards.map((card) => (card as HTMLElement).dataset.cardInfo),
      ),
  ).toEqual(incoming.deck);
  await expect(
    page.getByRole("button", { name: "Mute sound effects", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__arena?.state.emotes.muted),
    )
    .toBe(true);
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    raw,
  );
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
});

test("idle lobby tabs refresh saved progress and preferences without echo writes or lost focus", async ({
  page,
  context,
}) => {
  test.setTimeout(180000);
  const observer = await context.newPage();
  await observer.goto("/");
  await loaded(observer);
  await observer.bringToFront();
  await observer.locator("#deck-preview [data-card-info]").first().focus();
  await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), {
    key,
    raw,
  });
  await changed(observer);
  await expect(observer.locator("#battle-button")).toBeFocused();
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    raw,
  );
});

test("an open settings draft stays intact and the latest saved progress appears after closing it", async ({
  page,
  context,
}) => {
  test.setTimeout(180000);
  const observer = await context.newPage();
  await observer.goto("/");
  await loaded(observer);
  await observer.bringToFront();
  await observer
    .getByRole("button", { name: "Battle settings", exact: true })
    .click();
  await observer
    .getByRole("textbox", { name: "PLAYER NAME", exact: true })
    .fill("Draft Captain");
  await observer.locator("#sound-setting").check();
  await observer.evaluate(
    (key) =>
      window.addEventListener("storage", (e) => {
        if (e.key === key) (window as any).__profileEventSeen = true;
      }),
    key,
  );
  await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), {
    key,
    raw,
  });
  await expect
    .poll(() => observer.evaluate(() => (window as any).__profileEventSeen))
    .toBe(true);
  await expect(observer.locator("#player-name")).toHaveValue("Draft Captain");
  await expect(observer.locator("#sound-setting")).toBeChecked();
  await expect(observer.locator("#music-setting")).not.toBeChecked();
  await expect(observer.locator("#gold")).toHaveText("4,567");
  await observer
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await changed(observer);
  await expect(
    observer.getByRole("button", { name: "Battle settings", exact: true }),
  ).toBeFocused();
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    raw,
  );
});
