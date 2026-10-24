import { test, expect, type Page } from "@playwright/test";
import { STARTER_DECK, PRESETS } from "../../src/game/cards";
import { expectedCards } from "./native-assets";
const key = "browser-royale.profile.v1";
const shared = [
  "rocket",
  "rage",
  "hog-rider",
  "musketeer",
  "cannon",
  "skeletons",
  "goblins",
  "zap",
];
const code = "BRA-DECK-1:" + shared.join(",");
const saved = (page: Page) =>
  page.evaluate((key) => localStorage.getItem(key), key);
async function open(page: Page) {
  await page
    .getByRole("button", { name: `Cards ${expectedCards}`, exact: true })
    .click();
  await page.getByRole("button", { name: "Deck codes", exact: true }).click();
}
async function preview(page: Page) {
  await page.getByLabel("PASTE A SHARED DECK CODE", { exact: true }).fill(code);
  await page.getByRole("button", { name: "Preview deck", exact: true }).click();
  await expect(page.locator("[data-code-card]")).toHaveCount(8);
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ key, deck, decks }) => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            (window as any).__copiedDeck = text;
          },
        },
      });
      if (!localStorage.getItem(key))
        localStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            name: "Deck King",
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
        );
    },
    {
      key,
      deck: STARTER_DECK,
      decks: [STARTER_DECK, PRESETS[1].deck, PRESETS[2].deck],
    },
  );
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).__arena);
});

test("copies only the active deck, previews without mutation, selects a slot, undoes and persists", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const before = JSON.parse((await saved(page))!);
  await open(page);
  await page
    .getByRole("button", { name: "Copy deck code", exact: true })
    .click();
  await expect(page.locator("#deck-code-copy-status")).toHaveText(
    "Deck code copied.",
  );
  expect(await page.evaluate(() => (window as any).__copiedDeck)).toBe(
    "BRA-DECK-1:" + before.deck.join(","),
  );
  expect(JSON.parse((await saved(page))!)).toEqual(before);
  await preview(page);
  expect(
    await page
      .locator("[data-code-card]")
      .evaluateAll((els) =>
        els.map((e) => (e as HTMLElement).dataset.codeCard),
      ),
  ).toEqual(shared);
  await page
    .getByLabel("Destination battle deck", { exact: true })
    .selectOption("1");
  await page.locator("[data-code-card]").first().click();
  await page
    .getByRole("button", { name: "Back to deck codes", exact: true })
    .click();
  await expect(
    page.getByLabel("Destination battle deck", { exact: true }),
  ).toHaveValue("1");
  expect(JSON.parse((await saved(page))!)).toEqual(before);
  await page
    .getByRole("button", { name: "Use this deck", exact: true })
    .scrollIntoViewIfNeeded();
  await page.evaluate(async () => {
    const files = new Set(
      [
        ...document.querySelectorAll<SVGImageElement>(
          "#shared-deck-preview image",
        ),
      ].map((e) => e.href.baseVal),
    );
    await Promise.all(
      [...files].map((src) => {
        const image = new Image();
        image.src = src;
        return image.decode();
      }),
    );
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  await page.screenshot({
    path: info.outputPath("deck-code-preview.png"),
    fullPage: false,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Use this deck", exact: true })
    .click();
  await expect(page.locator(".deck-code-notice")).toContainText(
    "Battle deck 2 selected and saved.",
  );
  let current = JSON.parse((await saved(page))!);
  expect(current.deck).toEqual(shared);
  expect(current.activeDeck).toBe(1);
  expect(current.decks[0]).toEqual(before.decks[0]);
  expect(current.decks[2]).toEqual(before.decks[2]);
  expect(current.gold).toBe(before.gold);
  expect(current.history).toEqual(before.history);
  await page
    .getByRole("button", { name: "Undo deck change", exact: true })
    .click();
  expect(JSON.parse((await saved(page))!)).toEqual(before);
  await page
    .getByRole("button", { name: "Use this deck", exact: true })
    .click();
  await page.reload();
  expect(
    await page
      .locator("#deck-preview [data-card-info]")
      .evaluateAll((els) =>
        els.map((e) => (e as HTMLElement).dataset.cardInfo),
      ),
  ).toEqual(shared);
  current = JSON.parse((await saved(page))!);
  expect(current.trophies).toBe(before.trophies);
  expect(current.chests).toEqual(before.chests);
  expect(errors).toEqual([]);
});

test("rejects invalid codes, hides stale previews and keeps phone controls and focus usable", async ({
  page,
}, info) => {
  const before = await saved(page);
  await open(page);
  const input = page.getByLabel("PASTE A SHARED DECK CODE", { exact: true });
  for (const value of [
    "CR1.not-a-deck",
    "BRA-DECK-1:" + Array(8).fill("knight").join(","),
    "BRA-DECK-1:constructor," + shared.slice(1).join(","),
  ]) {
    await input.fill(value);
    await page
      .getByRole("button", { name: "Preview deck", exact: true })
      .click();
    await expect(page.getByRole("alert")).toBeVisible();
    expect(await saved(page)).toBe(before);
  }
  await preview(page);
  await input.fill("invalid");
  await expect(
    page.getByRole("button", { name: "Use this deck", exact: true }),
  ).not.toBeVisible();
  expect(await saved(page)).toBe(before);
  await preview(page);
  const close = page.getByRole("button", { name: "Close dialog", exact: true }),
    back = page.getByRole("button", {
      name: "Back to deck builder",
      exact: true,
    });
  await close.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(back).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  if (info.project.name !== "desktop")
    await page.setViewportSize({ width: 320, height: 740 });
  const use = page.getByRole("button", { name: "Use this deck", exact: true });
  await use.scrollIntoViewIfNeeded();
  expect((await use.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  if (info.project.name !== "desktop") {
    await page.setViewportSize({ width: 844, height: 390 });
    await back.scrollIntoViewIfNeeded();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await back.evaluate((e) => {
        const b = e.getBoundingClientRect(),
          d = e.closest(".modal")!.getBoundingClientRect();
        return Math.min(b.bottom, d.bottom) - Math.max(b.top, d.top);
      }),
    ).toBeGreaterThanOrEqual(44);
  }
  await back.click();
  await expect(
    page.getByRole("heading", {
      name: "Build your winning eight",
      exact: true,
    }),
  ).toBeVisible();
  expect(await saved(page)).toBe(before);
});

test("offers manual selection when clipboard APIs are unavailable", async ({
  page,
}) => {
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new DOMException("Denied", "NotAllowedError");
        },
      },
    });
    document.execCommand = () => false;
  });
  const before = await saved(page);
  await open(page);
  await page
    .getByRole("button", { name: "Copy deck code", exact: true })
    .click();
  await expect(page.locator("#deck-code-copy-status")).toHaveText(
    "Select and copy the code above.",
  );
  const text = page.getByLabel("YOUR CURRENT DECK", { exact: true });
  await expect(text).toBeFocused();
  expect(
    await text.evaluate((e) => {
      const t = e as HTMLTextAreaElement;
      return [t.selectionStart, t.selectionEnd, t.value.length];
    }),
  ).toEqual([
    0,
    (await text.inputValue()).length,
    (await text.inputValue()).length,
  ]);
  expect(await saved(page)).toBe(before);
});

test("keeps adoption and Undo available when browser storage refuses writes", async ({
  page,
}) => {
  const before = await saved(page);
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Full", "QuotaExceededError");
    };
  });
  await open(page);
  await preview(page);
  await page
    .getByRole("button", { name: "Use this deck", exact: true })
    .click();
  await expect(page.locator(".deck-code-notice")).toContainText(
    "selected for this session",
  );
  await expect(
    page.getByLabel("YOUR CURRENT DECK", { exact: true }),
  ).toHaveValue(code);
  expect(await saved(page)).toBe(before);
  await page
    .getByRole("button", { name: "Undo deck change", exact: true })
    .click();
  await expect(page.locator(".deck-code-notice")).toContainText(
    "restored for this session",
  );
  expect(await saved(page)).toBe(before);
  await expect(
    page.getByLabel("YOUR CURRENT DECK", { exact: true }),
  ).toHaveValue("BRA-DECK-1:" + JSON.parse(before!).deck.join(","));
});
