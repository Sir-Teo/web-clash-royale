import { test, expect } from "@playwright/test";
import { PRESETS, STARTER_DECK } from "../../src/game/cards";
import type { Profile } from "../../src/game/profile";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const initial: Profile = {
  version: 1,
  name: "Fresh Setup",
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
const code = "BRA-DECK-1:" + STARTER_DECK.join(",");

test("closing a temporary setup or its card details releases the abandoned preview return route", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  await page.addInitScript(
    ({ key, initial }) => localStorage.setItem(key, JSON.stringify(initial)),
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
  for (const inspect of [false, true]) {
    await page
      .getByRole("button", { name: `Cards ${expectedCards}`, exact: true })
      .click();
    await page.getByRole("button", { name: "Deck codes", exact: true }).click();
    await page
      .getByLabel("PASTE A SHARED DECK CODE", { exact: true })
      .fill(code);
    await page
      .getByRole("button", { name: "Preview deck", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Try this deck in practice", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Back to shared deck", exact: true }),
    ).toBeVisible();
    if (inspect) await page.locator('[data-practice-card="yours-0"]').click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.locator(".mode-select").click();
    await page
      .getByRole("button", { name: "Choose a practice opponent", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Back to battle modes", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Back to shared deck", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    expect(
      await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key),
    ).toEqual(initial);
  }
});
