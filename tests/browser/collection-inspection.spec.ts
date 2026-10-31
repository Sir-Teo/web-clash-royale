import { test, expect, type Page, type Locator } from "@playwright/test";
import { STARTER_DECK, PRESETS, CARDS } from "../../src/game/cards";
const fourCostTroops = CARDS.filter(
  (card) => card.kind === "troop" && card.cost === 4,
)
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((card) => card.id);
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

const collectionIds = (page: Page) =>
  page
    .locator("[data-collection]")
    .evaluateAll((cards) =>
      cards.map((card) => (card as HTMLElement).dataset.collection),
    );

test("rarity sorting groups matching cards and survives inspection and a temporary trial without saving", async ({
  page,
}, info) => {
  if (info.project.name !== "desktop")
    await page.setViewportSize({ width: 320, height: 740 });
  const before = await saved(page);
  await page.locator('[data-nav="cards"]').click();
  const sort = page.getByLabel("Sort cards", { exact: true });
  await sort.selectOption("rarity");
  expect((await collectionIds(page))[0]).toBe("ice-spirit");
  expect((await collectionIds(page)).at(-1)).toBe("lava-hound");
  await page.locator("#card-search").fill("goblin");
  const expected = [
    "goblins",
    "spear-goblins",
    "goblin-gang",
    "dart-goblin",
    "goblin-hut",
    "goblin-barrel",
  ];
  expect(await collectionIds(page)).toEqual(expected);
  await sort.selectOption("rarity-desc");
  const reverse = [
    "goblin-barrel",
    "dart-goblin",
    "goblin-hut",
    "goblins",
    "spear-goblins",
    "goblin-gang",
  ];
  expect(await collectionIds(page)).toEqual(reverse);
  const barrel = page.locator('[data-collection="goblin-barrel"]');
  await activate(page, barrel);
  await page.locator("#try-card-practice").click();
  await expect(page.locator("[data-trial-slot]")).toHaveCount(8);
  await page.locator("#card-trial-back").click();
  await page.locator("#card-back").click();
  await expect(barrel).toBeFocused();
  await expect(barrel).toBeInViewport();
  await expect(sort).toHaveValue("rarity-desc");
  await expect(page.locator("#card-search")).toHaveValue("goblin");
  expect(await collectionIds(page)).toEqual(reverse);
  expect((await sort.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(await saved(page)).toBe(before);
  await sort.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath("collection-rarity-sort.png"),
    animations: "disabled",
  });
});

test("plain-name search and combined collection filters preserve inspection state without editing progress", async ({
  page,
}) => {
  const before = await saved(page);
  await page.locator('[data-nav="cards"]').click();
  await page.getByRole("textbox", { name: "Search cards" }).fill("pekka");
  expect(await collectionIds(page)).toEqual(["mini-pekka", "pekka"]);
  await expect(page.locator("#collection-results")).toHaveText(
    `Showing 2 of ${CARDS.length} cards.`,
  );
  await page.getByRole("textbox", { name: "Search cards" }).fill("Mini Pekka");
  expect(await collectionIds(page)).toEqual(["mini-pekka"]);
  await page.getByRole("textbox", { name: "Search cards" }).fill("");
  await page
    .getByLabel("Sort cards", { exact: true })
    .selectOption("cost-desc");
  expect((await collectionIds(page))[0]).toBe("three-musketeers");
  await page.getByLabel("Sort cards", { exact: true }).selectOption("cost-asc");
  expect((await collectionIds(page))[0]).toBe("ice-spirit");
  await page.getByLabel("Elixir cost", { exact: true }).selectOption("4");
  await page.locator('[data-filter="troop"]').click();
  await expect(page.locator('[data-filter="troop"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator('[data-filter="all"]')).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  const sort = page.getByLabel("Sort cards", { exact: true });
  await sort.focus();
  await sort.selectOption("name");
  await expect(sort).toBeFocused();
  expect(await collectionIds(page)).toEqual(fourCostTroops);
  await expect(page.locator("#collection-results")).toHaveText(
    `Showing ${fourCostTroops.length} of ${CARDS.length} cards.`,
  );
  const dragon = page.locator('[data-collection="baby-dragon"]');
  await dragon.focus();
  await dragon.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Baby Dragon", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Back to collection", exact: true })
    .click();
  await expect(dragon).toBeFocused();
  await expect(page.getByLabel("Elixir cost", { exact: true })).toHaveValue(
    "4",
  );
  await expect(sort).toHaveValue("name");
  await expect(page.locator("[data-collection]")).toHaveCount(
    fourCostTroops.length,
  );
  await page.locator("#deck-codes").click();
  await page.locator("#deck-code-back").click();
  await expect(sort).toHaveValue("name");
  await expect(page.getByLabel("Elixir cost", { exact: true })).toHaveValue(
    "4",
  );
  expect(await saved(page)).toBe(before);
  await page.keyboard.press("Escape");
  await page.locator('[data-nav="cards"]').click();
  await expect(sort).toHaveValue("collection");
  await expect(page.getByLabel("Elixir cost", { exact: true })).toHaveValue(
    "all",
  );
  await expect(page.locator("[data-collection]")).toHaveCount(CARDS.length);
});

test("collection cost and sorting fit small screens and keep a filtered replacement in its saved slot", async ({
  page,
}, info) => {
  if (info.project.name !== "desktop")
    await page.setViewportSize({ width: 320, height: 568 });
  await page.locator('[data-deck="1"]').click();
  const before = JSON.parse((await saved(page))!);
  await page.locator('[data-nav="cards"]').click();
  await activate(page, page.locator('[data-edit-slot="3"]'));
  await page.locator('[data-filter="spell"]').click();
  const cost = page.getByLabel("Elixir cost", { exact: true });
  const sort = page.getByLabel("Sort cards", { exact: true });
  await cost.selectOption("4");
  await sort.selectOption("cost-desc");
  await page
    .getByRole("textbox", { name: "Search cards" })
    .fill("no such card");
  await expect(page.locator("[data-collection]")).toHaveCount(0);
  await expect(page.locator("#collection-results")).toHaveText(
    `Showing 0 of ${CARDS.length} cards.`,
  );
  await expect(
    page.getByText("No cards match these filters.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Search cards" }).fill("");
  expect(await collectionIds(page)).toEqual(["fireball", "freeze", "poison"]);
  if (info.project.name !== "desktop")
    await page
      .locator("#collection-results")
      .evaluate((element) => element.scrollIntoView({ block: "center" }));
  for (const control of [cost, sort]) {
    await control.scrollIntoViewIfNeeded();
    const box = (await control.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    const footer = (await page.locator(".builder-footer").boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(footer.y);
  }
  if (info.project.name !== "mobile")
    await page.screenshot({
      path: info.outputPath("collection-filters.png"),
      animations: "disabled",
    });
  expect(JSON.parse((await saved(page))!)).toEqual(before);
  await activate(page, page.locator('[data-collection="poison"]'));
  const expected = [...before.deck];
  expected[3] = "poison";
  expect(JSON.parse((await saved(page))!)).toEqual({
    ...before,
    deck: expected,
    decks: [before.decks[0], expected, before.decks[2]],
  });
  await expect(cost).toHaveValue("4");
  await expect(sort).toHaveValue("cost-desc");
  await expect(page.locator('[data-filter="spell"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("#collection-grid")).toHaveAttribute(
    "data-collection-mode",
    "inspect",
  );
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  expect(overflow).toBe(false);
});
