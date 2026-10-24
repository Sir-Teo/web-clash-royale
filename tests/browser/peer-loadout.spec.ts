import {
  test,
  chromium,
  expect as baseExpect,
  type Page,
} from "@playwright/test";
import {
  STARTER_DECK,
  PRESETS,
  CARD_MAP,
  type CardId,
} from "../../src/game/cards";
import { expectedCards, expectedEffects } from "./native-assets";
const expect = baseExpect.configure({ timeout: 20000 });
test.use({ serviceWorkers: "block", actionTimeout: 20000 });
const key = "browser-royale.profile.v1";
const state = (page: Page) =>
  page.evaluate(() => (window as any).__arena?.state);
const saved = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
const confirmed = (page: Page) =>
  page
    .locator("[data-peer-card]")
    .evaluateAll((elements) =>
      elements.map((e) => (e as HTMLElement).dataset.peerCard),
    );
async function init(page: Page, name: string) {
  await page.addInitScript(
    ({ name, deck, decks, key }) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          name,
          deck,
          decks,
          activeDeck: 0,
          sound: false,
          music: false,
          seenTutorial: true,
        }),
      );
    },
    {
      name,
      key,
      deck: STARTER_DECK,
      decks: [STARTER_DECK, PRESETS[1].deck, PRESETS[2].deck],
    },
  );
  await page.goto("/");
  await expect
    .poll(
      async () => {
        const s = await state(page);
        return s
          ? [
              s.loadedEffects,
              s.loadedAnimations,
              s.loadedBuildings,
              s.loadedCards,
            ]
          : [];
      },
      { timeout: 60000 },
    )
    .toEqual([expectedEffects, 19, 3, expectedCards]);
  await page.locator("#friend-button").click();
}
async function close(page: Page) {
  await page.keyboard.press("Escape");
}
async function name(page: Page, value: string) {
  await page.locator("#arena-settings").click();
  await page.locator("#player-name").fill(value);
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
}

for (const reverse of [false, true])
  test(`lobby edits synchronize loadouts and freeze match identity${reverse ? " with the project browser as guest" : ""}`, async ({
    page: projectPage,
    browser,
    browserName,
  }, info) => {
    test.skip(
      reverse && browserName !== "webkit",
      "The reverse WebKit role runs in the WebKit project.",
    );
    test.setTimeout(240000);
    const counterpart =
      browserName === "webkit"
        ? await chromium.launch({
            args: [
              "--enable-webgl",
              "--use-gl=angle",
              "--use-angle=swiftshader",
              "--enable-unsafe-swiftshader",
            ],
          })
        : undefined;
    const context = await (counterpart ?? browser).newContext({
      ...info.project.use,
      baseURL: "http://127.0.0.1:5188",
      serviceWorkers: "block",
    } as any);
    context.setDefaultTimeout(20000);
    const other = await context.newPage();
    const [page, friend] = reverse
      ? [other, projectPage]
      : [projectPage, other];
    if (info.project.name !== "desktop") {
      await page.setViewportSize({ width: 320, height: 740 });
      await friend.setViewportSize({ width: 320, height: 740 });
    }
    const errors: string[] = [];
    for (const p of [page, friend])
      p.on("pageerror", (e) => errors.push(e.message));
    try {
      await init(page, "Blue King");
      await init(friend, "Red King");
      test.skip(
        !(await projectPage.evaluate(
          () => typeof RTCPeerConnection === "function",
        )),
        "This browser platform does not expose RTCPeerConnection.",
      );
      await page.locator("#create-peer").click();
      await expect(page.locator("#peer-share")).toHaveValue(/^CR1\./);
      const invite = await page.locator("#peer-share").inputValue();
      // Host edits after creating the offer, before the other browser joins.
      await close(page);
      await page.locator('[data-deck="1"]').click();
      await name(page, "Blue Ahead");
      await page.locator("#friend-button").click();
      await expect(page.locator("#peer-share")).toHaveValue(invite);
      await friend.locator("#peer-invite").fill(invite);
      await friend.locator('#peer-join-form button[type="submit"]').click();
      await expect(friend.locator("#peer-share")).toHaveValue(/^CR1\./);
      const reply = await friend.locator("#peer-share").inputValue();
      // Guest edits after creating the answer, before the host accepts it.
      await close(friend);
      await friend.locator('[data-deck="2"]').click();
      await name(friend, "Red Ahead");
      await friend.locator("#friend-button").click();
      await expect(friend.locator("#peer-share")).toHaveValue(reply);
      await page.locator("#peer-reply").fill(reply);
      await page.locator('#peer-accept-form button[type="submit"]').click();
      for (const p of [page, friend]) {
        await expect(p.locator(".room-players")).toContainText("Blue Ahead", {
          timeout: 30000,
        });
        await expect(p.locator(".room-players")).toContainText("Red Ahead");
      }
      await expect.poll(() => confirmed(page)).toEqual(PRESETS[1].deck);
      await expect.poll(() => confirmed(friend)).toEqual(PRESETS[2].deck);
      await page.locator("#room-ready").click();
      await expect(page.locator("#room-ready")).toHaveText("Cancel ready");
      // A guest change must clear the already-ready host.
      await close(friend);
      await friend.locator('[data-deck="0"]').click();
      await name(friend, "Red Later");
      await friend.locator("#friend-button").click();
      await expect(page.locator("#room-ready")).toHaveText("Ready for battle");
      await expect.poll(() => confirmed(friend)).toEqual(STARTER_DECK);
      await expect(page.locator(".room-players")).toContainText("Red Later");
      // Unrelated settings do not clear readiness.
      await page.locator("#room-ready").click();
      await expect(page.locator("#room-ready")).toHaveText("Cancel ready");
      await close(page);
      await page.locator("#arena-settings").click();
      await page.locator("#music-setting").check();
      await page
        .getByRole("button", { name: "Save settings", exact: true })
        .click();
      await page.locator("#friend-button").click();
      await expect(page.locator("#room-ready")).toHaveText("Cancel ready");
      // A host order/name change also resets its own Ready check.
      await close(page);
      await page.locator('[data-nav="cards"]').click();
      await page.locator('[data-edit-slot="0"]').focus();
      await page.keyboard.press("Alt+ArrowRight");
      await page.locator("#deck-done").click();
      await name(page, "Blue Final");
      await page.locator("#friend-button").click();
      const deck = [...PRESETS[1].deck];
      [deck[0], deck[1]] = [deck[1], deck[0]];
      await expect.poll(() => confirmed(page)).toEqual(deck);
      await expect(page.locator("#room-ready")).toHaveText("Ready for battle");
      await expect(friend.locator(".room-players")).toContainText("Blue Final");
      await expect(page.locator("[data-peer-card]")).toHaveCount(8);
      expect(
        await page
          .locator(".modal")
          .evaluate((e) => e.scrollWidth > e.clientWidth),
      ).toBe(false);
      if (info.project.name !== "mobile")
        await page.screenshot({
          path: info.outputPath("peer-confirmed-deck.png"),
          animations: "disabled",
        });
      await page.locator("#room-ready").click();
      await expect(page.locator("#room-ready")).toHaveText("Cancel ready");
      await page.locator("[data-peer-card]").first().click();
      await page
        .getByRole("button", { name: "Back to friend lobby", exact: true })
        .click();
      await expect(page.locator("#room-ready")).toHaveText("Cancel ready");
      await friend.locator("#room-ready").click();
      for (const p of [page, friend])
        await expect
          .poll(async () => (await state(p)).multiplayer?.phase, {
            timeout: 30000,
          })
          .toBe("playing");
      await expect(page.locator(".match-bottom .player-name")).toHaveText(
        "Blue Final",
      );
      await expect(friend.locator(".match-bottom .player-name")).toHaveText(
        "Red Later",
      );
      await expect(friend.locator(".competitor.enemy b")).toHaveText(
        "Blue Final",
      );
      expect(
        (await state(page)).hand.every((id: CardId) => deck.includes(id)),
      ).toBe(true);
      expect(
        (await state(friend)).hand.every((id: CardId) =>
          STARTER_DECK.includes(id),
        ),
      ).toBe(true);
      // A saved name change during play is for future matches.
      await name(page, "Blue Future");
      await expect(page.locator(".match-bottom .player-name")).toHaveText(
        "Blue Final",
      );
      await expect(friend.locator(".competitor.enemy b")).toHaveText(
        "Blue Final",
      );
      expect((await saved(page)).name).toBe("Blue Future");
      await expect
        .poll(async () => (await state(page)).intro.blocking)
        .toBe(false);
      const hand = await state(page);
      const slot = hand.hand.findIndex(
        (id: CardId) =>
          CARD_MAP[id].kind === "troop" && CARD_MAP[id].cost <= hand.elixir,
      );
      expect(slot).toBeGreaterThanOrEqual(0);
      await page.keyboard.press(String(slot + 1));
      await page.keyboard.press("Enter");
      await expect.poll(async () => (await state(page)).actions).toBe(1);
      await friend.locator("#pause-button").click();
      await friend.locator("#online-surrender").click();
      for (const p of [page, friend])
        await expect.poll(async () => (await saved(p)).history.length).toBe(1);
      const blue = (await saved(page)).history[0],
        red = (await saved(friend)).history[0];
      expect(blue.replay.deck).toEqual(deck);
      expect(blue.replay.enemyDeck).toEqual(STARTER_DECK);
      expect(red.replay.deck).toEqual(deck);
      expect(red.replay.enemyDeck).toEqual(STARTER_DECK);
      expect(red.replay.perspective).toBe("red");
      expect(blue.opponent).toBe("Red Later");
      expect(red.opponent).toBe("Blue Final");
      expect(blue.replay.actions).toHaveLength(1);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      await counterpart?.close();
    }
  });
