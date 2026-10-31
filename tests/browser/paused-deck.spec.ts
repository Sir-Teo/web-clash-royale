import { test, expect } from "@playwright/test";
import { CARD_MAP, PRESETS, STARTER_DECK } from "../../src/game/cards";
import type { Profile } from "../../src/game/profile";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const initial: Profile = {
  version: 1,
  name: "Deck Inspector",
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
for (const practice of [false, true])
  test(`${practice ? "practice" : "ordinary"} paused deck inspection retains the captured deck, focus and resume behavior`, async ({
    page,
  }, info) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
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
    const state = () => page.evaluate(() => (window as any).__arena?.state);
    await expect
      .poll(async () => (await state())?.loadedCards, { timeout: 60000 })
      .toBe(expectedCards);
    const saved = await page.evaluate((key) => localStorage.getItem(key), key);
    if (practice) {
      await page.locator(".mode-select").click();
      await page
        .getByRole("button", {
          name: "Choose a practice opponent",
          exact: true,
        })
        .click();
      await page
        .getByRole("combobox", { name: "Your practice deck", exact: true })
        .selectOption("0");
      await page
        .getByRole("button", { name: "Start practice", exact: true })
        .click();
    } else await page.locator("#battle-button").click();
    await expect
      .poll(async () => (await state()).intro.blocking, { timeout: 15000 })
      .toBe(false);
    await page
      .getByRole("button", { name: "Pause battle", exact: true })
      .click();
    const held = await state();
    const inspect = page.getByRole("button", {
      name: "Inspect battle deck",
      exact: true,
    });
    if (info.project.name === "desktop") {
      await inspect.focus();
      await inspect.press("Enter");
    } else await inspect.tap();
    await expect(page.locator("#modal-title")).toHaveText("Your battle deck");
    const expected = practice ? initial.decks[0] : initial.deck;
    expect(
      await page
        .locator("[data-battle-card]")
        .evaluateAll((cards) =>
          cards.map((card) => (card as HTMLElement).dataset.nativeCard),
        ),
    ).toEqual(expected);
    await expect(page.locator(".match-deck-heading > span")).toContainText(
      `${(expected.reduce((sum, id) => sum + CARD_MAP[id].cost, 0) / 8).toFixed(1)} average`,
    );
    await expect(
      page.locator(
        "#card-edit-deck,[data-edit-slot],[data-use-match-deck],#practice-deck",
      ),
    ).toHaveCount(0);
    expect(
      await page
        .getByRole("dialog")
        .evaluate((e) => e.scrollWidth <= e.clientWidth),
    ).toBe(true);
    for (const box of await page
      .locator("[data-battle-card]")
      .evaluateAll((cards) =>
        cards.map((card) => {
          const b = card.getBoundingClientRect();
          return { width: b.width, height: b.height };
        }),
      )) {
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({
      path: info.outputPath("paused-starting-deck.png"),
      animations: "disabled",
    });
    const card = page.locator('[data-battle-card="0"]');
    const original = await card.elementHandle();
    if (info.project.name === "desktop") await card.click();
    else await card.tap();
    await expect(page.locator("#modal-title")).toHaveText(
      CARD_MAP[expected[0]].name,
    );
    await expect(page.locator(".level-pill")).toContainText(
      "CURRENT ARENA STATS",
    );
    await expect(page.locator("#card-edit-deck")).toHaveCount(0);
    if (practice) {
      await page
        .locator("#arena-canvas canvas")
        .evaluate((canvas: HTMLCanvasElement) => {
          const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
          const extension = gl!.getExtension("WEBGL_lose_context")!;
          (window as any).__pausedDeckContext = extension;
          extension.loseContext();
        });
      await expect
        .poll(async () => (await state()).graphicsAvailable)
        .toBe(false);
      await page.evaluate(() =>
        (window as any).__pausedDeckContext.restoreContext(),
      );
      await expect
        .poll(async () => (await state()).graphicsAvailable, { timeout: 60000 })
        .toBe(true);
      await expect(page.locator("#modal-title")).toHaveText(
        CARD_MAP[expected[0]].name,
      );
    }
    await page.waitForTimeout(150);
    expect(await state()).toMatchObject({
      paused: true,
      time: held.time,
      hand: held.hand,
      elixir: held.elixir,
      actions: held.actions,
    });
    await page
      .getByRole("button", { name: "Back to battle deck", exact: true })
      .click();
    await expect(card).toBeFocused();
    expect(
      await card.evaluate(
        (element, original) => element === original,
        original,
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "Back to pause menu", exact: true })
      .click();
    await expect(page.locator("#modal-title")).toHaveText("Battle paused");
    await expect(page.locator("#resume-button")).toBeFocused();
    expect((await state()).paused).toBe(true);
    await expect(
      page.getByRole("button", { name: "Restart practice", exact: true }),
    ).toHaveCount(practice ? 1 : 0);
    await inspect.click();
    const last = page.locator('[data-battle-card="7"]');
    await last.focus();
    await last.press("Space");
    await expect(page.locator("#modal-title")).toHaveText(
      CARD_MAP[expected[7]].name,
    );
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator("#arena-canvas canvas")).toBeFocused();
    expect((await state()).paused).toBe(false);
    await expect
      .poll(async () => (await state()).time)
      .toBeGreaterThan(held.time);
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
      saved,
    );
    expect(errors).toEqual([]);
  });
