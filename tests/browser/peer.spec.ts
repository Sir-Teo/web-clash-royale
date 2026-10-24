import { expectedCards, expectedEffects } from "./native-assets";
import {
  test,
  expect as baseExpect,
  webkit,
  chromium,
  devices,
  type Page,
} from "@playwright/test";
import { CARD_MAP, STARTER_DECK } from "../../src/game/cards";
import { readFileSync } from "node:fs";
import { observeCombatAudio, playedCombatAudio } from "./audio-helpers";
const nativeAudio = JSON.parse(
  readFileSync("src/game/combat-audio-data.json", "utf8"),
);
const expect = baseExpect.configure({ timeout: 15000 });
test.use({ serviceWorkers: "block", actionTimeout: 20000 });
const state = (page: Page) =>
  page.evaluate(() => (window as any).__arena?.state ?? {});
async function init(page: Page, name: string, sound = false) {
  await page.addInitScript(
    ({ name, sound }) =>
      localStorage.setItem(
        "browser-royale.profile.v1",
        JSON.stringify({
          version: 1,
          name,
          sound,
          music: false,
          seenTutorial: true,
        }),
      ),
    { name, sound },
  );
  await page.goto("/");
  // The lobby markup arrives before asynchronous native asset construction.
  // Wait for that work before starting pointer actions on a busy software GPU.
  await expect
    .poll(
      async () => {
        const ready = await state(page);
        return [
          ready.loadedEffects,
          ready.loadedAnimations,
          ready.loadedBuildings,
          ready.loadedCards,
        ];
      },
      { timeout: 60000 },
    )
    .toEqual([expectedEffects, 19, 3, expectedCards]);
  await expect(page.locator("#friend-button")).toBeVisible({ timeout: 60000 });
  await page.locator("#friend-button").click();
}
async function deploy(page: Page, x = 4, y = 22) {
  await expect.poll(async () => (await state(page)).intro.blocking).toBe(false);
  const before = await state(page);
  const slot = before.hand.findIndex(
    (id: keyof typeof CARD_MAP) =>
      CARD_MAP[id].cost <= before.elixir && CARD_MAP[id].kind === "troop",
  );
  expect(slot).toBeGreaterThanOrEqual(0);
  for (let attempt = 0; attempt < 2; attempt++) {
    await expect(page.locator("#connection-status")).toContainText("FRIENDLY", {
      timeout: 30000,
    });
    await page.locator(`[data-slot="${slot}"]`).click();
    const point = await page.evaluate(
      ({ x, y }) => (window as any).__arena.project(x, y),
      { x, y },
    );
    if (await page.evaluate(() => navigator.maxTouchPoints > 0))
      await page.touchscreen.tap(point.x, point.y);
    else await page.mouse.click(point.x, point.y);
    try {
      await expect
        .poll(async () => (await state(page)).actions, { timeout: 10000 })
        .toBeGreaterThan(before.actions);
      return before.hand[slot];
    } catch (error) {
      // A transient WebRTC disconnect pauses the battle and drops that input.
      // Wait for the browser's own reconnect state, then try the same card once.
      if ((await state(page)).actions > before.actions)
        return before.hand[slot];
      if (attempt) throw error;
    }
  }
  return before.hand[slot];
}
test("static browsers exchange invites, fight, pause together and replay without a game server", async ({
  page,
  browser,
  browserName,
}, info) => {
  test.setTimeout(240000);
  const crossBrowser =
    process.env.ARENA_CROSS_BROWSER === "1"
      ? await (browserName === "webkit" ? chromium : webkit).launch()
      : undefined;
  const context = await (crossBrowser ?? browser).newContext({
    ...info.project.use,
    ...(crossBrowser ? devices["iPhone 13"] : {}),
    baseURL: "http://127.0.0.1:5188",
    serviceWorkers: "block",
  } as any);
  const friend = await context.newPage();
  context.setDefaultTimeout(20000);
  const errors: string[] = [];
  const backendRequests: string[] = [];
  for (const p of [page, friend]) {
    await observeCombatAudio(p);
    p.on("pageerror", (error) => errors.push(error.message));
    p.on("websocket", (socket) => {
      if (new URL(socket.url()).pathname === "/battle")
        backendRequests.push(socket.url());
    });
    p.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/"))
        backendRequests.push(request.url());
    });
  }
  try {
    await init(page, "Blue King", true);
    await init(friend, "Red King", true);
    await page
      .getByRole("button", { name: "Create an invite", exact: true })
      .click();
    await expect(page.locator("#peer-share")).toBeVisible({ timeout: 20000 });
    const invite = await page.locator("#peer-share").inputValue();
    expect(invite).toMatch(/^CR1\./);
    await friend.locator("#peer-invite").fill(invite);
    await friend
      .getByRole("button", { name: "Join friend", exact: true })
      .click();
    await expect(friend.locator("#peer-share")).toBeVisible({ timeout: 20000 });
    const reply = await friend.locator("#peer-share").inputValue();
    await page.locator("#peer-reply").fill(reply);
    await page
      .getByRole("button", { name: "Connect friend", exact: true })
      .click();
    for (const p of [page, friend]) {
      await expect(p.locator(".room-players")).toContainText("Red King", {
        timeout: 30000,
      });
      await expect(p.locator(".room-players")).toContainText("Blue King");
    }
    await page.screenshot({
      path: `docs/screenshots/${info.project.name}-peer-room.png`,
      animations: "disabled",
    });
    await page
      .getByRole("button", { name: "Ready for battle", exact: true })
      .click();
    await friend
      .getByRole("button", { name: "Ready for battle", exact: true })
      .click();
    for (const p of [page, friend]) {
      await expect
        .poll(async () => (await state(p)).multiplayer?.phase)
        .toBe("playing");
      expect((await state(p)).multiplayer.transport).toBe("peer");
    }
    const deployed = await deploy(page, 4, 18);
    await deploy(friend, 4, 18);
    await expect.poll(async () => (await state(page)).actions).toBe(2);
    await expect.poll(async () => (await state(friend)).actions).toBe(2);
    const deploymentGroup =
      nativeAudio.profiles[deployed].spawn.components[0].sound;
    const deploymentFiles = nativeAudio.sounds[deploymentGroup]
      .filter((voice: any) => voice.file)
      .map((voice: any) => `/assets/audio/${voice.file}.ogg`);
    for (const p of [page, friend])
      await expect
        .poll(
          async () =>
            (await playedCombatAudio(p, deploymentFiles)).some(
              (entry: any) => entry.outcome === "playing",
            ),
          { timeout: 15000 },
        )
        .toBe(true);
    for (const p of [page, friend])
      await expect
        .poll(
          async () =>
            (
              await playedCombatAudio(p, [
                "/assets/audio/archer_tower_fire_05.ogg",
              ])
            ).some((entry: any) => entry.outcome === "playing"),
          { timeout: 30000 },
        )
        .toBe(true);
    await friend
      .getByRole("button", { name: "King emotes", exact: true })
      .click();
    await friend
      .getByRole("button", { name: "Send Good luck!", exact: true })
      .click();
    await expect
      .poll(async () => (await state(page)).emotes.red?.kind)
      .toBe("good-luck");
    await expect
      .poll(async () => (await state(friend)).emotes.blue?.kind)
      .toBe("good-luck");
    await page.screenshot({
      path: `docs/screenshots/${info.project.name}-peer-battle.png`,
    });
    // Visibility hooks exercise a real data-channel notification and host pause.
    await friend.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(page.locator("#connection-status")).toContainText(
      "Battle paused",
    );
    const pausedTime = (await state(page)).time;
    await page.waitForTimeout(500);
    expect((await state(page)).time).toBe(pausedTime);
    await friend.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: false,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(page.locator("#connection-status")).toContainText("FRIENDLY");
    await expect
      .poll(async () => (await state(friend)).time)
      .toBeGreaterThan(pausedTime);
    await friend.getByRole("button", { name: "Battle options" }).click();
    await friend.locator("#online-surrender").click();
    await expect.poll(async () => (await state(page)).winner).toBe("blue");
    await expect.poll(async () => (await state(friend)).winner).toBe("red");
    await expect(
      friend.getByRole("button", { name: "Watch replay", exact: true }),
    ).toBeVisible({ timeout: 20000 });
    for (const p of [page, friend]) {
      await expect
        .poll(() =>
          p.evaluate(
            () =>
              JSON.parse(localStorage.getItem("browser-royale.profile.v1")!)
                .history[0]?.opponentType,
          ),
        )
        .toBe("friend");
      const record = await p.evaluate(
        () =>
          JSON.parse(localStorage.getItem("browser-royale.profile.v1")!)
            .history[0],
      );
      expect(record.replay.enemyDeck).toEqual(STARTER_DECK);
    }
    await friend
      .getByRole("button", { name: "Watch replay", exact: true })
      .click();
    await expect.poll(async () => (await state(friend)).screen).toBe("replay");
    await expect(friend.locator(".competitor.enemy div > span")).toHaveText(
      "Friendly battle replay",
    );
    expect(backendRequests).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await crossBrowser?.close();
  }
});

test("invalid invites stay recoverable and phone connection forms fit", async ({
  page,
}, info) => {
  await init(page, "King");
  await page.locator("#peer-invite").fill("CR1.not-a-valid-invite");
  await page.getByRole("button", { name: "Join friend", exact: true }).click();
  await expect(page.locator(".room-error")).toContainText("incomplete");
  await expect(
    page.getByRole("button", { name: "Create an invite", exact: true }),
  ).toBeEnabled();
  if (info.project.name !== "desktop")
    await page.setViewportSize({ width: 844, height: 390 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
