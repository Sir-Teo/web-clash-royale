import { test, expect, chromium, type Page } from "@playwright/test";
import { PRESETS, STARTER_DECK } from "../../src/game/cards";
import type { Profile } from "../../src/game/profile";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block", actionTimeout: 30000 });
const key = "browser-royale.profile.v1";
const initial: Profile = {
  version: 1,
  name: "Earlier Captain",
  trophies: 321,
  best: 400,
  gold: 4567,
  wins: 4,
  battles: 12,
  crowns: 15,
  chests: ["gold", "silver"],
  deck: [...PRESETS[2].deck],
  decks: [[...STARTER_DECK], [...PRESETS[1].deck], [...PRESETS[2].deck]],
  activeDeck: 2,
  sound: false,
  music: false,
  emotesMuted: false,
  seenTutorial: true,
  history: [],
};
const saved = (page: Page): Promise<Profile> =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
const raw = (page: Page) =>
  page.evaluate((key) => localStorage.getItem(key), key);
const loaded = (page: Page) =>
  expect
    .poll(
      () => page.evaluate(() => (window as any).__arena?.state.loadedCards),
      { timeout: 60000 },
    )
    .toBe(expectedCards);
async function rename(page: Page, value: string) {
  await page.locator("#arena-settings").click();
  await page.locator("#player-name").fill(value);
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
}

test("connected lobby chest, sound and slot actions preserve newer progress and current chest contents", async ({
  browserName,
  baseURL,
}, info) => {
  test.skip(
    info.project.name !== "desktop" || browserName !== "chromium",
    "Connected-lobby concurrency is exercised once with desktop Chromium.",
  );
  test.setTimeout(300000);
  const localBrowser = await chromium.launch({
    args: [
      "--enable-webgl",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--disable-features=WebRtcHideLocalIpsWithMdns",
    ],
  });
  try {
    const context = await localBrowser.newContext({
      baseURL,
      serviceWorkers: "block",
    });
    context.setDefaultTimeout(30000);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      ({ key, initial }) => {
        if (!localStorage.getItem(key))
          localStorage.setItem(key, JSON.stringify(initial));
      },
      { key, initial },
    );
    await page.goto("/");
    await loaded(page);
    const guestContext = await localBrowser.newContext({
      baseURL: new URL(page.url()).origin,
      serviceWorkers: "block",
    });
    const friend = await guestContext.newPage();
    friend.on("pageerror", (error) => errors.push(error.message));
    try {
      await friend.addInitScript(
        ({ key, initial }) =>
          localStorage.setItem(
            key,
            JSON.stringify({
              ...initial,
              name: "Guest Captain",
              chests: [],
              activeDeck: 0,
              deck: initial.decks[0],
            }),
          ),
        { key, initial },
      );
      await friend.goto("/");
      await loaded(friend);
      await page.locator("#friend-button").click();
      await page.locator("#create-peer").click();
      await expect(page.locator("#peer-share")).toHaveValue(/^CR1\./, {
        timeout: 30000,
      });
      const offer = await page.locator("#peer-share").inputValue();
      await friend.locator("#friend-button").click();
      await friend.locator("#peer-invite").fill(offer);
      await friend.locator('#peer-join-form button[type="submit"]').click();
      await expect(friend.locator("#peer-share")).toHaveValue(/^CR1\./, {
        timeout: 30000,
      });
      await page
        .locator("#peer-reply")
        .fill(await friend.locator("#peer-share").inputValue());
      await page.locator('#peer-accept-form button[type="submit"]').click();
      for (const target of [page, friend])
        await expect(target.locator(".room-players")).toContainText(
          "Guest Captain",
          { timeout: 45000 },
        );
      await page.keyboard.press("Escape");
      const newer = await context.newPage();
      newer.on("pageerror", (error) => errors.push(error.message));
      await newer.goto("/");
      await loaded(newer);
      await newer.bringToFront();
      await rename(newer, "Newer Captain");
      await newer.locator('[data-deck="1"]').click();
      await newer.locator('[data-chest="0"]').click();
      await newer.locator("#claim-done").click();
      await newer.locator(".mode-select").click();
      await newer
        .getByRole("button", {
          name: "Choose a practice opponent",
          exact: true,
        })
        .click();
      await newer.locator("#start-practice").click();
      await newer
        .getByRole("button", { name: "Pause battle", exact: true })
        .click();
      await newer
        .getByRole("button", { name: "Leave battle", exact: true })
        .click();
      await expect(
        newer.getByRole("button", { name: "Practice again", exact: true }),
      ).toBeVisible({ timeout: 30000 });
      const latest = await saved(newer),
        latestRaw = await raw(newer);
      expect(latest).toMatchObject({
        name: "Newer Captain",
        gold: 4917,
        chests: ["silver"],
        activeDeck: 1,
        battles: initial.battles + 1,
      });
      expect(latest.history).toHaveLength(1);
      await page.bringToFront();
      // Connected rooms deliberately retain their confirmed player until an action.
      await expect(page.locator(".player-card .player-name")).toHaveText(
        initial.name,
      );
      await page.locator('[data-chest="0"]').click();
      expect(await raw(page)).toBe(latestRaw);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.locator("#toast")).toHaveText(
        "Chest slots changed in another tab. Choose a current chest.",
      );
      await expect(page.locator("[data-chest]")).toHaveCount(1);
      await page.locator('[data-chest="0"]').click();
      const afterChest = { ...latest, gold: latest.gold + 150, chests: [] };
      expect(await saved(page)).toEqual(afterChest);
      await page.locator("#claim-done").click();
      await newer.bringToFront();
      await newer.locator("#return-home").click();
      await expect(newer.locator("#gold")).toHaveText("5,067");
      await rename(newer, "Latest Captain");
      await newer.locator('[data-deck="2"]').click();
      const beforeSound = await saved(newer);
      await page.bringToFront();
      await page.locator(".sound-toggle").click();
      expect(await saved(page)).toEqual({ ...beforeSound, sound: true });
      await expect(page.locator(".sound-toggle")).toHaveAttribute(
        "aria-label",
        "Mute sound effects",
      );
      await newer.bringToFront();
      await rename(newer, "Final Captain");
      await newer.locator('[data-deck="0"]').click();
      await newer.locator("#edit-deck").click();
      await newer.locator('[data-edit-slot="0"]').click();
      await newer.locator("#deck-move-later").click();
      await newer.locator("#deck-done").click();
      await newer.locator('[data-deck="2"]').click();
      const beforeSlot = await saved(newer);
      const expected = {
        ...beforeSlot,
        activeDeck: 0,
        deck: [...beforeSlot.decks[0]],
      };
      await page.bringToFront();
      await page.locator('[data-deck="0"]').focus();
      await page.locator('[data-deck="0"]').press("Enter");
      expect(await saved(page)).toEqual(expected);
      await expect(page.locator('[data-deck="0"]')).toBeFocused();
      await page.locator("#friend-button").click();
      await expect(page.locator(".room-players")).toContainText(
        "Final Captain",
        {
          timeout: 30000,
        },
      );
      await expect(friend.locator(".room-players")).toContainText(
        "Final Captain",
        { timeout: 30000 },
      );
      expect(
        await page
          .locator("[data-peer-card]")
          .evaluateAll((cards) =>
            cards.map((card) => (card as HTMLElement).dataset.peerCard),
          ),
      ).toEqual(expected.deck);
      await page.goto("/");
      await loaded(page);
      expect(await saved(page)).toEqual(expected);
      expect(errors).toEqual([]);
    } finally {
      await guestContext.close();
    }
  } finally {
    await localBrowser.close();
  }
});

test("lobby controls retain sound, deck selection and chest rewards through reload", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
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
  await loaded(page);
  const sound = page.locator(".sound-toggle");
  await sound.focus();
  await sound.press("Space");
  expect((await saved(page)).sound).toBe(true);
  await expect(sound).toHaveAttribute("aria-label", "Mute sound effects");
  await page.locator('[data-deck="0"]').focus();
  await page.locator('[data-deck="0"]').press("Enter");
  await expect(page.locator('[data-deck="0"]')).toBeFocused();
  expect(await saved(page)).toMatchObject({
    activeDeck: 0,
    deck: initial.decks[0],
  });
  for (const type of ["gold", "silver"]) {
    await page.locator('[data-chest="0"]').click();
    await expect(page.locator(".chest-reward h3")).toHaveText(`${type} chest`);
    await page.locator("#claim-done").click();
  }
  await expect(page.locator("[data-chest]")).toHaveCount(0);
  await sound.focus();
  await sound.press("Space");
  const expected = {
    ...initial,
    activeDeck: 0,
    deck: initial.decks[0],
    gold: initial.gold + 500,
    chests: [],
  };
  expect(await saved(page)).toEqual(expected);
  await expect(sound).toHaveAttribute("aria-label", "Enable sound effects");
  await page.reload();
  await loaded(page);
  expect(await saved(page)).toEqual(expected);
  await expect(page.locator("#gold")).toHaveText("5,067");
  expect(errors).toEqual([]);
});
