import { test, expect } from "@playwright/test";
import { PRESETS, STARTER_DECK } from "../../src/game/cards";
import type { Profile } from "../../src/game/profile";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const initial: Profile = {
  version: 1,
  name: "Original King",
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
for (const action of ["reload", "close"] as const) {
  test(`${action} of an older tab preserves newer saved name, deck and chest rewards`, async ({
    page,
    context,
  }, info) => {
    test.setTimeout(180000);
    await page.addInitScript(
      ({ key, initial }) => {
        if (!localStorage.getItem(key))
          localStorage.setItem(key, JSON.stringify(initial));
      },
      { key, initial },
    );
    if (info.project.name !== "desktop")
      await page.setViewportSize({ width: 320, height: 740 });
    await page.goto("/");
    const loaded = (target: typeof page) =>
      expect
        .poll(
          () =>
            target.evaluate(() => (window as any).__arena?.state.loadedCards),
          { timeout: 60000 },
        )
        .toBe(expectedCards);
    await loaded(page);
    const older = await context.newPage();
    await older.goto("/");
    await loaded(older);
    await page.bringToFront();
    await page
      .getByRole("button", { name: "Battle settings", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "PLAYER NAME", exact: true })
      .fill("Newer Captain");
    await page
      .getByRole("button", { name: "Save settings", exact: true })
      .click();
    await page.locator('[data-deck="1"]').click();
    await page.locator('[data-chest="0"]').click();
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    const newer = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!),
      key,
    );
    expect(newer).toMatchObject({
      name: "Newer Captain",
      activeDeck: 1,
      deck: PRESETS[1].deck,
      gold: initial.gold + 350,
      chests: [],
    });
    if (action === "reload") {
      await older.reload();
      await loaded(older);
      await expect(older.locator(".player-card .player-name")).toHaveText(
        "Newer Captain",
      );
    } else {
      // WebKit can leave a graceful target close pending. Run document unload
      // through navigation, then close the empty tab with the ordinary API.
      await older.goto("about:blank");
      await older.close();
    }
    expect(
      await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key),
    ).toEqual(newer);
    await page.reload();
    await loaded(page);
    await expect(page.locator(".player-card .player-name")).toHaveText(
      "Newer Captain",
    );
    expect(
      await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key),
    ).toEqual(newer);
  });
}
