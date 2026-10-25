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
async function init(page: Page, name: string) {
  await page.addInitScript(
    ({ key, name, deck, decks }) =>
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
          gold: 777,
          trophies: 123,
          battles: 10,
          wins: 4,
          crowns: 12,
          chests: ["silver"],
          history: [],
        }),
      ),
    {
      key,
      name,
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
              s.loadedAnimations,
              s.loadedCards,
              s.loadedEffects,
              s.loadedBuildings,
            ]
          : [];
      },
      { timeout: 60000 },
    )
    .toEqual([19, expectedCards, expectedEffects, 3]);
  await page.locator("#friend-button").click();
}
async function deploy(page: Page) {
  await expect
    .poll(async () => (await state(page)).intro.blocking, { timeout: 15000 })
    .toBe(false);
  const current = await state(page);
  const slot = current.hand.findIndex(
    (id: CardId) =>
      CARD_MAP[id].cost <= current.elixir && CARD_MAP[id].kind === "troop",
  );
  expect(slot).toBeGreaterThanOrEqual(0);
  await page.keyboard.press(String(slot + 1));
  await expect.poll(async () => (await state(page)).selected).toBe(slot);
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await state(page)).actions)
    .toBe(current.actions + 1);
}
for (const reverse of [false, true])
  test(`friends play three distinct rounds on one connection${reverse ? " with the project browser as guest" : ""}`, async ({
    page: projectPage,
    browser,
    browserName,
  }, info) => {
    test.skip(
      reverse && browserName !== "webkit",
      "Reverse host role runs in WebKit",
    );
    test.setTimeout(300000);
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
    const [host, guest] = reverse ? [other, projectPage] : [projectPage, other];
    const pages = [host, guest];
    if (info.project.name !== "desktop")
      for (const p of pages)
        await p.setViewportSize({ width: 320, height: 740 });
    const errors: string[] = [];
    for (const p of pages) p.on("pageerror", (e) => errors.push(e.message));
    try {
      await init(host, "Blue King");
      await init(guest, "Red King");
      test.skip(
        !(await projectPage.evaluate(
          () => typeof RTCPeerConnection === "function",
        )),
        "RTCPeerConnection is unavailable on this platform",
      );
      const before = await Promise.all(pages.map(saved));
      await host.locator("#create-peer").click();
      await expect(host.locator("#peer-share")).toHaveValue(/^CR1\./);
      await guest
        .locator("#peer-invite")
        .fill(await host.locator("#peer-share").inputValue());
      await guest.locator('#peer-join-form button[type="submit"]').click();
      await expect(guest.locator("#peer-share")).toHaveValue(/^CR1\./);
      await host
        .locator("#peer-reply")
        .fill(await guest.locator("#peer-share").inputValue());
      await host.locator('#peer-accept-form button[type="submit"]').click();
      for (const p of pages)
        await expect(p.locator("#room-ready")).toBeVisible();
      const ids: string[] = [],
        seeds: number[] = [];
      let connection = "";
      for (let round = 0; round < 3; round++) {
        await host.locator("#room-ready").click();
        await expect(host.locator("#room-ready")).toHaveText("Cancel ready");
        expect((await state(guest)).screen).toBe("lobby");
        await guest.locator("#room-ready").click();
        for (const p of pages)
          await expect
            .poll(async () => (await state(p)).multiplayer?.phase, {
              timeout: 30000,
            })
            .toBe("playing");
        const current = await state(host),
          mirror = await state(guest);
        if (round === 0) connection = current.multiplayer.code;
        expect(current.multiplayer.code).toBe(connection);
        expect(mirror.multiplayer.code).toBe(connection);
        expect(current.multiplayer.matchId).toBe(mirror.multiplayer.matchId);
        ids.push(current.multiplayer.matchId);
        expect(new Set(ids).size).toBe(round + 1);
        expect(current.actions).toBe(0);
        expect(mirror.actions).toBe(0);
        expect(current.winner).toBeNull();
        expect(mirror.winner).toBeNull();
        expect(current.time).toBeLessThan(10);
        if (round === 1) {
          expect(
            current.hand.every((id: CardId) => PRESETS[1].deck.includes(id)),
          ).toBe(true);
          expect(
            mirror.hand.every((id: CardId) => PRESETS[2].deck.includes(id)),
          ).toBe(true);
          await expect(host.locator(".match-bottom .player-name")).toHaveText(
            "Blue Next",
          );
          await expect(guest.locator(".competitor.enemy b")).toHaveText(
            "Blue Next",
          );
        }
        // Fresh hands, command sequences and reaction cooldowns work in every round.
        await deploy(host);
        await expect.poll(async () => (await state(guest)).actions).toBe(1);
        await deploy(guest);
        await host
          .getByRole("button", { name: "King emotes", exact: true })
          .click();
        await host.locator('[data-emote="thumbs"]').click();
        await expect
          .poll(async () => (await state(guest)).emotes.red?.kind)
          .toBe("thumbs");
        await guest.locator("#pause-button").click();
        await guest.locator("#online-surrender").click();
        for (const p of pages) {
          await expect
            .poll(async () => (await saved(p)).history.length)
            .toBe(round + 1);
          await expect(p.locator("#rematch")).toHaveText(
            "Play again with friend",
          );
          await expect(p.locator("#rematch-status")).toContainText(
            "Both players must agree",
          );
        }
        const blue = await saved(host),
          red = await saved(guest);
        const a = blue.history[0],
          b = red.history[0];
        expect(a.matchId).toBe(ids[round]);
        expect(b.matchId).toBe(ids[round]);
        expect(a.replay.actions).toHaveLength(2);
        expect(b.replay.actions).toEqual(a.replay.actions);
        expect(b.replay.seed).toBe(a.replay.seed);
        expect(b.replay.perspective).toBe("red");
        seeds.push(a.replay.seed);
        for (const [i, p] of [blue, red].entries()) {
          expect(p.battles).toBe(before[i].battles + round + 1);
          expect(p.gold).toBe(before[i].gold);
          expect(p.trophies).toBe(before[i].trophies);
          expect(p.chests).toEqual(before[i].chests);
        }
        if (round === 1) {
          expect(a.replay.deck).toEqual(PRESETS[1].deck);
          expect(a.replay.enemyDeck).toEqual(PRESETS[2].deck);
          expect(b.opponent).toBe("Blue Next");
        }
        if (round === 2) break;
        // Either player can request, cancel, then accept a rematch.
        const first = round === 0 ? host : guest,
          second = round === 0 ? guest : host;
        await first.locator("#rematch").click();
        await expect(first.locator("#rematch")).toHaveText(
          "Cancel rematch request",
        );
        await expect(first.locator("#rematch-status")).toContainText(
          "Waiting for",
        );
        await expect(second.locator("#rematch-status")).toContainText(
          "wants another battle",
        );
        await first.screenshot({
          path: info.outputPath(`rematch-request-${round}.png`),
        });
        await first.locator("#rematch").click();
        await expect(second.locator("#rematch-status")).toContainText(
          "Both players must agree",
        );
        await first.locator("#rematch").click();
        await expect(first.locator("#rematch")).toHaveText(
          "Cancel rematch request",
        );
        await second.locator("#rematch").click();
        for (const p of pages) {
          await expect(p.locator("#room-ready")).toHaveText("Ready for battle");
          expect((await state(p)).screen).toBe("lobby");
          await expect(p.locator("#create-peer")).toHaveCount(0);
          await expect(p.locator("[data-peer-card]")).toHaveCount(8);
        }
        if (round === 0) {
          await host.keyboard.press("Escape");
          await host.locator('[data-deck="1"]').click();
          await host.locator("#arena-settings").click();
          await host.locator("#player-name").fill("Blue Next");
          await host
            .getByRole("button", { name: "Save settings", exact: true })
            .click();
          await host.locator("#friend-button").click();
          await guest.keyboard.press("Escape");
          await guest.locator('[data-deck="2"]').click();
          await guest.locator("#friend-button").click();
          await expect(host.locator(".room-players")).toContainText(
            "Blue Next",
          );
          await expect(guest.locator(".room-players")).toContainText(
            "Blue Next",
          );
          await expect
            .poll(() =>
              host
                .locator("[data-peer-card]")
                .evaluateAll((nodes) =>
                  nodes.map((e) => (e as HTMLElement).dataset.peerCard),
                ),
            )
            .toEqual(PRESETS[1].deck);
          await expect
            .poll(() =>
              guest
                .locator("[data-peer-card]")
                .evaluateAll((nodes) =>
                  nodes.map((e) => (e as HTMLElement).dataset.peerCard),
                ),
            )
            .toEqual(PRESETS[2].deck);
        }
      }
      expect(new Set(seeds).size).toBe(3);
      for (const p of pages) {
        const history = (await saved(p)).history;
        expect(new Set(history.map((r: any) => r.matchId)).size).toBe(3);
        expect(history[2].replay.deck).toEqual(STARTER_DECK);
      }
      // Leaving for a replay preserves the other result and offers a new invite.
      await guest.locator("#watch-replay").click();
      await expect(host.locator("#rematch-status")).toContainText(
        "disconnected",
      );
      await expect(host.locator("#rematch")).toHaveText("Create a new invite");
      expect((await saved(host)).history).toHaveLength(3);
      await host.locator("#rematch").click();
      await expect(host.locator("#create-peer")).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      await counterpart?.close();
    }
  });
