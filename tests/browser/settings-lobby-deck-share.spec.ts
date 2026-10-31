import { test, expect } from "@playwright/test";
import { PRESETS, STARTER_DECK, type CardId } from "../../src/game/cards";
import { encodeDeckCode } from "../../src/game/deck-code";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const reversed = [...PRESETS[1].deck].reverse();
const profile = {
  version: 1,
  name: "Share Captain",
  trophies: 123,
  best: 400,
  gold: 4321,
  wins: 4,
  battles: 12,
  crowns: 15,
  chests: ["gold"],
  history: [],
  deck: reversed,
  decks: [[...STARTER_DECK], reversed, [...PRESETS[2].deck]],
  activeDeck: 1,
  sound: false,
  music: false,
  emotesMuted: false,
  seenTutorial: true,
};
test.beforeEach(async ({ page }, info) => {
  await page.addInitScript(
    ({ key, profile }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify(profile));
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (value: string) => {
            (window as any).__lobbyDeckCode = value;
          },
        },
      });
    },
    { key, profile },
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
});

test("shares the selected ordered lobby deck directly and restores its opener and page position", async ({
  page,
}, info) => {
  const share = page.getByRole("button", {
    name: "Share battle deck code",
    exact: true,
  });
  for (const [slot, deck] of [
    [1, reversed],
    [2, PRESETS[2].deck],
  ] as const) {
    if (slot === 2) await page.locator('[data-deck="2"]').click();
    const before = await page.evaluate((key) => localStorage.getItem(key), key);
    await share.scrollIntoViewIfNeeded();
    await share.focus();
    const scroll = await page.evaluate(() => window.scrollY);
    for (const button of [share, page.locator("#edit-deck")])
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({
      path: info.outputPath(`lobby-share-slot-${slot}.png`),
      animations: "disabled",
    });
    if (info.project.name === "desktop") await share.press("Enter");
    else await share.tap();
    await expect(
      page.getByRole("heading", {
        name: `Battle deck ${slot + 1} code`,
        exact: true,
      }),
    ).toBeVisible();
    const field = page.getByRole("textbox", { name: "Deck code", exact: true });
    await expect(field).toHaveValue(encodeDeckCode(deck));
    await expect(field).toHaveAttribute("readonly", "");
    await page.locator("#copy-battle-deck-code").click();
    await expect(page.locator("#battle-code-status")).toHaveText(
      "Deck code copied.",
    );
    expect(await page.evaluate(() => (window as any).__lobbyDeckCode)).toBe(
      encodeDeckCode(deck),
    );
    await page
      .getByRole("button", { name: "Back to arena", exact: true })
      .click();
    await expect(share).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(scroll, 0);
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
      before,
    );
  }
});

test("shares an unsaved session deck with manual copy and ignores a late clipboard rejection after closing", async ({
  page,
}) => {
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    (window as any).__shareSaveAttempts = 0;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) {
        (window as any).__shareSaveAttempts++;
        throw new Error("blocked");
      }
      return original.call(this, name, value);
    };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("unavailable");
        },
      },
    });
    document.execCommand = () => false;
  }, key);
  const original = await page.evaluate((key) => localStorage.getItem(key), key);
  await page.locator("#edit-deck").click();
  await page.locator('[data-edit-slot="0"]').click();
  await page.locator('[data-collection="knight"]').click();
  await page.keyboard.press("Escape");
  const attempts = await page.evaluate(
    () => (window as any).__shareSaveAttempts,
  );
  expect(attempts).toBeGreaterThan(0);
  const sessionDeck: CardId[] = [...reversed];
  sessionDeck[0] = "knight";
  const share = page.locator("#share-deck");
  await share.click();
  const field = page.locator("#battle-deck-code-value");
  await expect(field).toHaveValue(encodeDeckCode(sessionDeck));
  await page.locator("#copy-battle-deck-code").click();
  await expect(page.locator("#battle-code-status")).toHaveText(
    "Select and copy the code above.",
  );
  await expect(field).toBeFocused();
  expect(
    await field.evaluate((e: HTMLTextAreaElement) => [
      e.selectionStart,
      e.selectionEnd,
    ]),
  ).toEqual([0, encodeDeckCode(sessionDeck).length]);
  await page.keyboard.press("Escape");
  await expect(share).toBeFocused();
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () =>
          new Promise<void>((_resolve, reject) => {
            (window as any).__rejectLobbyCopy = () => reject(new Error("late"));
          }),
      },
    });
  });
  await share.click();
  await page.locator("#copy-battle-deck-code").click();
  await page.keyboard.press("Escape");
  await page.evaluate(async () => {
    (window as any).__rejectLobbyCopy();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
  });
  await expect(share).toBeFocused();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__shareSaveAttempts)).toBe(
    attempts,
  );
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    original,
  );
});
