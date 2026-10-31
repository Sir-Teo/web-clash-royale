import { test, expect } from "@playwright/test";
import { PRESETS, STARTER_DECK } from "../../src/game/cards";
import { encodeDeckCode } from "../../src/game/deck-code";
import { SOLO_OPPONENTS } from "../../src/game/opponents";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const initial = {
  version: 1,
  name: "Share Captain",
  sound: false,
  music: false,
  seenTutorial: true,
  deck: STARTER_DECK,
  decks: [STARTER_DECK, PRESETS[1].deck, PRESETS[2].deck],
  activeDeck: 0,
};
for (const practice of [false, true]) {
  test(`${practice ? "practice" : "ordinary"} captured deck codes retain cards, inspection and pause state`, async ({
    page,
  }, info) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      ({ key, initial }) => {
        localStorage.setItem(key, JSON.stringify(initial));
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: async (value: string) => {
              if ((window as any).__denyDeckCopy)
                throw new Error("Clipboard unavailable");
              (window as any).__copiedDeck = value;
            },
          },
        });
        document.execCommand = () => false;
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
      await page.locator("#practice-deck").selectOption("curated:2");
      await page.locator("#practice-opponent").selectOption("8");
      await page
        .getByRole("button", { name: "Start practice", exact: true })
        .click();
    } else await page.locator("#battle-button").click();
    await page
      .getByRole("button", { name: "Pause battle", exact: true })
      .click();
    const held = await state();
    await page
      .getByRole("button", { name: "Inspect battle deck", exact: true })
      .click();
    const share = page.getByRole("button", {
      name: "Share deck code",
      exact: true,
    });
    const field = page.getByRole("textbox", { name: "Deck code", exact: true });
    const copy = page.getByRole("button", {
      name: "Copy deck code",
      exact: true,
    });
    const back = page.getByRole("button", {
      name: "Back to deck inspection",
      exact: true,
    });
    for (const side of practice ? ["yours", "opponent"] : ["yours"]) {
      if (practice)
        await page.locator("#battle-inspect-side").selectOption(side);
      const deck =
        side === "opponent"
          ? SOLO_OPPONENTS[8].deck
          : practice
            ? SOLO_OPPONENTS[2].deck
            : STARTER_DECK;
      const code = encodeDeckCode(deck);
      if (info.project.name === "desktop") {
        await share.focus();
        await share.press("Enter");
      } else await share.tap();
      await expect(field).toHaveValue(code);
      await expect(field).toHaveAttribute("readonly", "");
      expect((await copy.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await copy.click();
      await expect
        .poll(() => page.evaluate(() => (window as any).__copiedDeck))
        .toBe(code);
      await expect(page.locator("#battle-code-status")).toHaveText(
        "Deck code copied.",
      );
      await expect(copy).toBeFocused();
      await page.evaluate(() => {
        (window as any).__denyDeckCopy = true;
      });
      await copy.click();
      await expect(page.locator("#battle-code-status")).toHaveText(
        "Select and copy the code above.",
      );
      await expect(field).toBeFocused();
      expect(
        await field.evaluate((field: HTMLTextAreaElement) =>
          field.value.slice(field.selectionStart, field.selectionEnd),
        ),
      ).toBe(code);
      await page.screenshot({
        path: info.outputPath(`${side}-deck-code.png`),
        animations: "disabled",
      });
      await back.click();
      await expect(share).toBeFocused();
      if (practice)
        await expect(page.locator("#battle-inspect-side")).toHaveValue(side);
      expect(await state()).toMatchObject({
        time: held.time,
        seed: held.seed,
        actions: held.actions,
        paused: true,
      });
      await page.evaluate(() => {
        (window as any).__denyDeckCopy = false;
      });
    }
    // A clipboard completion after closing its dialog must leave the resumed arena alone.
    await share.click();
    await page.evaluate(() => {
      navigator.clipboard.writeText = () =>
        new Promise<void>((_resolve, reject) => {
          (window as any).__finishDeckCopy = () =>
            reject(new Error("Clipboard unavailable"));
        });
    });
    await copy.click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.evaluate(() => (window as any).__finishDeckCopy());
    await expect(page.locator("#arena-canvas canvas")).toBeFocused();
    expect((await state()).paused).toBe(false);
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
      saved,
    );
    expect(errors).toEqual([]);
  });
}
