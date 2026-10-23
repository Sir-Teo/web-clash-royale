import {
  test,
  expect as baseExpect,
  webkit,
  chromium,
  devices,
  type Page,
} from "@playwright/test";
import { CARD_MAP } from "../../src/game/cards";
const expect = baseExpect.configure({ timeout: 15000 });
test.use({ serviceWorkers: "block", actionTimeout: 20000 });
const state = (page: Page) =>
  page.evaluate(() => (window as any).__arena?.state ?? {});
async function init(page: Page, name: string) {
  await page.addInitScript(
    (name) =>
      localStorage.setItem(
        "browser-royale.profile.v1",
        JSON.stringify({
          version: 1,
          name,
          sound: false,
          music: false,
          seenTutorial: true,
        }),
      ),
    name,
  );
  await page.goto("/");
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
  await page.locator(`[data-slot="${slot}"]`).click();
  const point = await page.evaluate(
    ({ x, y }) => (window as any).__arena.project(x, y),
    { x, y },
  );
  if (await page.evaluate(() => navigator.maxTouchPoints > 0))
    await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  await expect
    .poll(async () => (await state(page)).actions)
    .toBeGreaterThan(before.actions);
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
    await init(page, "Blue King");
    await init(friend, "Red King");
    await page
      .getByRole("button", { name: "Create an invite", exact: true })
      .click();
    await expect(page.locator("#peer-share")).toBeVisible({ timeout: 20000 });
    const invite = await page.locator("#peer-share").inputValue();
    expect(invite).toContain("#battle=CR1.");
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
    await deploy(page);
    await deploy(friend);
    await expect.poll(async () => (await state(page)).actions).toBe(2);
    await expect.poll(async () => (await state(friend)).actions).toBe(2);
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
    await friend
      .getByRole("button", { name: "Watch replay", exact: true })
      .click();
    await expect.poll(async () => (await state(friend)).screen).toBe("replay");
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
