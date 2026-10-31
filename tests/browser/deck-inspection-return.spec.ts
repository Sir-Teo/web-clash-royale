import { test, expect, type Page } from "@playwright/test";
import { PRESETS, STARTER_DECK } from "../../src/game/cards";
import type { Profile } from "../../src/game/profile";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const initial: Profile = {
  version: 1,
  name: "Deck Reader",
  trophies: 123,
  best: 400,
  gold: 1234,
  wins: 1,
  battles: 2,
  crowns: 3,
  chests: ["gold"],
  deck: [...STARTER_DECK],
  decks: [[...STARTER_DECK], [...PRESETS[1].deck], [...PRESETS[2].deck]],
  activeDeck: 0,
  sound: false,
  music: false,
  emotesMuted: false,
  seenTutorial: true,
  history: [
    {
      id: 1,
      date: "2026-10-31T12:00:00.000Z",
      winner: "red",
      crowns: [0, 0],
      mode: "classic",
      opponent: "Recorded Rival",
      opponentType: "ai",
      playerName: "Deck Reader",
      replay: {
        version: 56,
        rulesFamily: "origin",
        seed: 1,
        mode: "classic",
        deck: [...STARTER_DECK],
        enemyDeck: [...PRESETS[1].deck],
        actions: [],
        duration: 0,
      },
    },
  ],
};
const saved = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
for (const source of ["code", "recorded"] as const) {
  test(`${source} card inspection returns to the same deck preview, focus, scroll and Undo`, async ({
    page,
  }, info) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      ({ key, initial }) => {
        localStorage.setItem(key, JSON.stringify(initial));
      },
      { key, initial },
    );
    await page.setViewportSize({
      width: info.project.name === "desktop" ? 1440 : 320,
      height: 640,
    });
    await page.goto("/");
    await expect
      .poll(
        () => page.evaluate(() => (window as any).__arena?.state.loadedCards),
        { timeout: 60000 },
      )
      .toBe(expectedCards);
    if (source === "code") {
      await page
        .getByRole("button", { name: `Cards ${expectedCards}`, exact: true })
        .click();
      await page
        .getByRole("button", { name: "Deck codes", exact: true })
        .click();
      await page
        .getByLabel("PASTE A SHARED DECK CODE", { exact: true })
        .fill("BRA-DECK-1:" + PRESETS[1].deck.join(","));
      await page
        .getByRole("button", { name: "Preview deck", exact: true })
        .click();
    } else {
      await page
        .getByRole("button", { name: "Battle log", exact: true })
        .click();
      await page.locator('[data-match-details="0"]').click();
    }
    const target = page.getByLabel("Destination battle deck", { exact: true });
    await target.selectOption("2");
    const pace = page.getByRole("combobox", {
      name: "Practice pace",
      exact: true,
    });
    await pace.selectOption("double");
    const card = page
      .locator(
        source === "code"
          ? "[data-code-card]"
          : '[data-match-side="opponent"] [data-match-card]',
      )
      .last();
    const back = page.getByRole("button", {
      name: source === "code" ? "Back to deck codes" : "Back to battle details",
      exact: true,
    });
    const use = page.getByRole("button", {
      name: source === "code" ? "Use this deck" : "Use opponent deck",
      exact: true,
    });
    const inspect = async () => {
      await card.scrollIntoViewIfNeeded();
      await card.focus();
      await card.evaluate((e) => {
        (window as any).__inspectedDeckCard = e;
      });
      const scroll = await page
        .getByRole("dialog")
        .evaluate((e) => e.scrollTop);
      if (info.project.name === "desktop") await card.press("Enter");
      else await card.tap();
      await expect(back).toBeVisible();
      await back.click();
      await expect(card).toBeFocused();
      expect(
        await card.evaluate((e) => e === (window as any).__inspectedDeckCard),
      ).toBe(true);
      expect(
        await page.getByRole("dialog").evaluate((e) => e.scrollTop),
      ).toBeCloseTo(scroll, 0);
      await expect(target).toHaveValue("2");
      await expect(pace).toHaveValue("double");
    };
    const before = await saved(page);
    await inspect();
    expect(await saved(page)).toEqual(before);
    await use.click();
    const adopted = await saved(page);
    expect(adopted.deck).toEqual(PRESETS[1].deck);
    expect(adopted.activeDeck).toBe(2);
    await inspect();
    expect(await saved(page)).toEqual(adopted);
    await expect(
      page.getByRole("button", { name: "Undo deck change", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Undo deck change", exact: true })
      .click();
    expect(await saved(page)).toEqual(before);
    expect(errors).toEqual([]);
  });
}
