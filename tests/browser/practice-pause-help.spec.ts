import { test, expect, type Page } from "@playwright/test";
import { STARTER_DECK, PRESETS } from "../../src/game/cards";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const state = (page: Page) =>
  page.evaluate(() => (window as any).__arena.state);
for (const practice of [false, true])
  test(`${practice ? "practice" : "ordinary"} pause Help retains the menu and resumes safely when closed`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      ({ key, deck, decks }) => {
        localStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            name: "Help Captain",
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
            activeDeck: 0,
            deck,
            decks,
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
    if (info.project.name !== "desktop")
      await page.setViewportSize({ width: 320, height: 740 });
    await page.goto("/");
    await expect
      .poll(
        () => page.evaluate(() => (window as any).__arena?.state.loadedCards),
        { timeout: 60000 },
      )
      .toBe(expectedCards);
    const before = await page.evaluate((key) => localStorage.getItem(key), key);
    if (practice) {
      await page.locator(".mode-select").click();
      await page.locator("#choose-practice-opponent").click();
      await page.locator("#practice-pace").selectOption("double");
      await page.locator("#start-practice").click();
    } else await page.locator("#battle-button").click();
    await expect
      .poll(async () => (await state(page)).intro.blocking, { timeout: 15000 })
      .toBe(false);
    await page.locator("#pause-button").click();
    if (practice) {
      await page.locator("#practice-speed").selectOption("2");
      await page.locator("#practice-opening").selectOption("fresh");
    }
    const frozen = await state(page);
    const help = page.locator("#pause-help");
    expect((await help.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    if (info.project.name === "desktop") {
      await help.focus();
      await help.press("Enter");
    } else await help.tap();
    await expect(page.locator("#modal-title")).toHaveText(
      "Your first crown starts here.",
    );
    await expect(
      page.getByRole("heading", { name: "Make your move.", exact: true }),
    ).toBeVisible();
    await expect(page.locator("#help-done")).toHaveText("Back to pause menu");
    expect(await state(page)).toMatchObject({
      time: frozen.time,
      paused: true,
      speed: practice ? 2 : 1,
      hand: frozen.hand,
    });
    await page.screenshot({
      path: info.outputPath("pause-help.png"),
      animations: "disabled",
    });
    await page.locator("#help-done").click();
    await expect(page.locator("#modal-title")).toHaveText("Battle paused");
    await expect(help).toBeFocused();
    if (practice) {
      await expect(page.locator("#practice-speed")).toHaveValue("2");
      await expect(page.locator("#practice-opening")).toHaveValue("fresh");
    }
    expect((await state(page)).time).toBe(frozen.time);
    await help.click();
    if (practice) await page.locator(".close-modal").click();
    else await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect
      .poll(async () => (await state(page)).time)
      .toBeGreaterThan(frozen.time);
    expect((await state(page)).paused).toBe(false);
    expect((await state(page)).speed).toBe(practice ? 2 : 1);
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
      before,
    );
    expect(errors).toEqual([]);
  });
