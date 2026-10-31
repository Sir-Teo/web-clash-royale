import { test, expect } from "@playwright/test";
import { PRESETS, STARTER_DECK } from "../../src/game/cards";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const profile = {
  version: 1,
  name: "Shortcut Captain",
  trophies: 0,
  best: 0,
  gold: 0,
  wins: 0,
  battles: 0,
  crowns: 0,
  chests: [],
  history: [],
  deck: [...STARTER_DECK],
  decks: [[...STARTER_DECK], [...PRESETS[1].deck], [...PRESETS[2].deck]],
  activeDeck: 0,
  sound: true,
  music: false,
  emotesMuted: false,
  seenTutorial: true,
};

for (const context of ["lobby", "battle"] as const) {
  test(`${context} speaker accepts its advertised M key while focused and retains native activation and modifier behavior`, async ({
    page,
  }) => {
    await page.addInitScript(
      ({ key, profile }) => localStorage.setItem(key, JSON.stringify(profile)),
      { key, profile },
    );
    await page.goto("/");
    await expect
      .poll(
        () => page.evaluate(() => (window as any).__arena?.state.loadedCards),
        { timeout: 60000 },
      )
      .toBe(expectedCards);
    if (context === "battle") {
      await page.locator("#battle-button").click();
      await expect
        .poll(
          () =>
            page.evaluate(() => (window as any).__arena.state.intro.blocking),
          { timeout: 15000 },
        )
        .toBe(false);
    }
    const button = page.locator(
      context === "lobby" ? ".sound-toggle" : "#battle-sound-button",
    );
    await expect(button).toHaveAttribute("aria-keyshortcuts", "m");
    await button.focus();
    await page.keyboard.press("m");
    await expect
      .poll(() =>
        page.evaluate(
          (key) => JSON.parse(localStorage.getItem(key)!).sound,
          key,
        ),
      )
      .toBe(false);
    await expect(button).toHaveAttribute("aria-label", "Enable sound effects");
    await expect(button).toBeFocused();
    await page.keyboard.down("m");
    await page.keyboard.down("m");
    await page.keyboard.up("m");
    expect(
      await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!).sound,
        key,
      ),
    ).toBe(true);
    await button.press("Space");
    await expect(button).toHaveAttribute("aria-label", "Enable sound effects");
    const beforeModifier = await page.evaluate(
      (key) => localStorage.getItem(key),
      key,
    );
    expect(
      await button.evaluate((element) => {
        const event = new KeyboardEvent("keydown", {
          key: "m",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        });
        element.dispatchEvent(event);
        return event.defaultPrevented;
      }),
    ).toBe(false);
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
      beforeModifier,
    );
    if (context === "battle")
      expect(
        await page.evaluate(() => (window as any).__arena.state.paused),
      ).toBe(false);
  });
}
