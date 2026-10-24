import { test, expect, type Page, type Locator } from "@playwright/test";
import { STARTER_DECK, PRESETS } from "../../src/game/cards";
const key = "browser-royale.profile.v1";
const saved = (page: Page) =>
  page.evaluate((key) => localStorage.getItem(key), key);
async function activate(page: Page, control: Locator) {
  if (await page.evaluate(() => navigator.maxTouchPoints > 0))
    await control.tap();
  else await control.click();
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ key, deck, decks }) =>
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          name: "Collection King",
          gold: 2345,
          trophies: 123,
          best: 123,
          wins: 3,
          battles: 4,
          crowns: 5,
          chests: ["gold"],
          seenTutorial: true,
          sound: false,
          music: false,
          emotesMuted: false,
          deck,
          decks,
          activeDeck: 0,
          history: [],
        }),
      ),
    {
      key,
      deck: STARTER_DECK,
      decks: [STARTER_DECK, PRESETS[1].deck, PRESETS[2].deck],
    },
  );
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).__arena);
});

test("collection inspection retains search, filters, focus and the saved profile", async ({
  page,
}) => {
  const before = await saved(page);
  const cards = page.locator('[data-nav="cards"]');
  await cards.focus();
  await cards.press("Enter");
  await page.locator('[data-filter="spell"]').click();
  await page.locator("#card-search").fill("freeze");
  const freeze = page.locator('[data-collection="freeze"]');
  await freeze.focus();
  await freeze.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Freeze", exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-card-stat="Duration"] b')).toHaveText("4 s");
  expect(await saved(page)).toBe(before);
  await page
    .getByRole("button", { name: "Back to collection", exact: true })
    .click();
  await expect(freeze).toBeFocused();
  await expect(freeze).toBeInViewport();
  await expect(page.locator("#card-search")).toHaveValue("freeze");
  await expect(page.locator('[data-filter="spell"]')).toHaveClass(/active/);
  await expect(page.locator("[data-collection]")).toHaveCount(1);
  await expect(page.locator("#collection-grid")).toHaveAttribute(
    "data-collection-mode",
    "inspect",
  );
  await expect(page.locator("#deck-move-later")).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(cards).toBeFocused();
  expect(await saved(page)).toBe(before);
  await cards.press("Enter");
  const knight = page.locator('[data-collection="knight"]');
  await expect(knight).toHaveClass(/in-deck/);
  expect(await knight.evaluate((e) => getComputedStyle(e).filter)).toBe("none");
  await knight.focus();
  await knight.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Knight", exact: true }),
  ).toBeVisible();
  expect(await saved(page)).toBe(before);
});

test("canceling a replacement enables touch inspection and a later replacement still uses the chosen slot", async ({
  page,
}, info) => {
  if (info.project.name !== "desktop")
    await page.setViewportSize({ width: 320, height: 568 });
  const before = JSON.parse((await saved(page))!);
  await page.locator('[data-nav="cards"]').click();
  const slot = page.locator('[data-edit-slot="0"]');
  await activate(page, slot);
  await expect(slot).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#collection-grid")).toHaveAttribute(
    "data-collection-mode",
    "replace",
  );
  const knight = page.locator('[data-collection="knight"]');
  expect(await knight.evaluate((e) => getComputedStyle(e).filter)).not.toBe(
    "none",
  );
  await activate(page, slot);
  await expect(slot).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#collection-grid")).toHaveAttribute(
    "data-collection-mode",
    "inspect",
  );
  expect(await knight.evaluate((e) => getComputedStyle(e).filter)).toBe("none");
  await activate(page, page.locator('[data-collection="minion-horde"]'));
  await expect(page.locator('[data-card-stat="Count"] b')).toHaveText("6");
  expect(JSON.parse((await saved(page))!)).toEqual(before);
  await activate(
    page,
    page.getByRole("button", { name: "Back to collection", exact: true }),
  );
  await activate(page, slot);
  await activate(page, page.locator('[data-collection="freeze"]'));
  const expected = ["freeze", ...before.deck.slice(1)];
  await expect(
    page.getByRole("heading", {
      name: "Build your winning eight",
      exact: true,
    }),
  ).toBeVisible();
  expect(JSON.parse((await saved(page))!)).toEqual({
    ...before,
    deck: expected,
    decks: [expected, ...before.decks.slice(1)],
  });
  await expect(page.locator("#collection-grid")).toHaveAttribute(
    "data-collection-mode",
    "inspect",
  );
  await activate(page, page.locator('[data-collection="freeze"]'));
  await expect(
    page.getByRole("dialog", { name: "Freeze", exact: true }),
  ).toBeVisible();
  await activate(
    page,
    page.getByRole("button", { name: "Back to collection", exact: true }),
  );
  await expect(page.locator('[data-collection="freeze"]')).toBeFocused();
  await expect(page.locator('[data-edit-slot="0"]')).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});
