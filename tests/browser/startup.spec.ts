import { test, expect, type BrowserContext } from "@playwright/test";
import { WebSocket } from "ws";
import { STARTER_DECK } from "../../src/game/cards";
import { PROTOCOL, RECONNECT_MS } from "../../src/network/protocol";
import type {
  ServerMessage,
  RoomState,
  BattleSnapshot,
} from "../../src/network/protocol";

test.use({ serviceWorkers: "block" });
const graphics = /\/(?:src\/main\.ts|assets\/main-[^/]+\.js)(?:\?|$)/;
test("a cold browser restores its saved seat before graphics load beyond the reconnect window", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000);
  await page.addInitScript(() =>
    localStorage.setItem(
      "browser-royale.profile.v1",
      JSON.stringify({ version: 1, sound: false, seenTutorial: true }),
    ),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Play with a friend" }).click();
  await page
    .getByRole("button", { name: "Create a room", exact: true })
    .click();
  await expect(page.locator(".room-code")).toBeVisible();
  const code = (await page.locator(".room-code").textContent())!.trim();
  const opponent = new WebSocket("ws://127.0.0.1:5188/battle");
  let room: RoomState | undefined;
  let snapshot: BattleSnapshot | undefined;
  opponent.on("message", (bytes) => {
    const m: ServerMessage = JSON.parse(bytes.toString());
    if (m.type === "room") room = m.room;
    if (m.type === "state") snapshot = m.state;
  });
  let cold: BrowserContext | undefined;
  let release = () => {};
  try {
    await new Promise<void>((resolve, reject) => {
      opponent.once("open", resolve);
      opponent.once("error", reject);
    });
    opponent.send(
      JSON.stringify({
        type: "join",
        version: PROTOCOL,
        name: "Waiting King",
        deck: STARTER_DECK,
        code,
      }),
    );
    await expect.poll(() => room?.players.length).toBe(2);
    opponent.send(JSON.stringify({ type: "ready", ready: true }));
    await page
      .getByRole("button", { name: "Ready for battle", exact: true })
      .click();
    await expect
      .poll(() => snapshot?.tick, { timeout: 15000 })
      .toBeGreaterThan(0);
    const saved = await page.evaluate(() => ({
      room: sessionStorage.getItem("browser-royale.room.v1")!,
      profile: localStorage.getItem("browser-royale.profile.v1")!,
    }));
    cold = await browser.newContext({
      ...info.project.use,
      baseURL: "http://127.0.0.1:5188",
      serviceWorkers: "block",
    } as any);
    const previous = page;
    page = await cold.newPage();
    await page.addInitScript((saved) => {
      sessionStorage.setItem("browser-royale.room.v1", saved.room);
      localStorage.setItem("browser-royale.profile.v1", saved.profile);
    }, saved);
    let graphicsRequested = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(graphics, async (route) => {
      graphicsRequested = true;
      await gate;
      await route.continue();
    });
    // A new context guarantees a cold module cache in WebKit as well as
    // Chromium, while retaining the exact saved session from the closed tab.
    await previous.close();
    await page.goto("/", { waitUntil: "commit" });
    await expect.poll(() => graphicsRequested, { timeout: 15000 }).toBe(true);
    await expect(page.locator("#startup-status")).toHaveText(
      "Rejoining your battle…",
    );
    await page.waitForTimeout(RECONNECT_MS + 1500);
    expect(room?.players.find((p) => p.team === "blue")?.connected).toBe(true);
    expect(snapshot?.winner, snapshot?.reason).toBeNull();
    expect(snapshot!.tick).toBeGreaterThan(30 * 30);
    release();
    await expect
      .poll(
        () =>
          page.evaluate(
            () => (window as any).__arena?.state.multiplayer?.connected,
          ),
        { timeout: 30000 },
      )
      .toBe(true);
    const restored = await page.evaluate(() => (window as any).__arena.state);
    expect(restored.winner, restored.reason).toBeNull();
    expect(restored.time).toBeGreaterThan(30);
    expect(restored.intro.active).toBe(false);
  } finally {
    release();
    opponent.close();
    await cold?.close();
  }
});

test("an expired saved room returns to the room controls without breaking startup", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() =>
    sessionStorage.setItem(
      "browser-royale.room.v1",
      JSON.stringify({ code: "ABC234", token: "0".repeat(64) }),
    ),
  );
  await page.goto("/");
  await expect(page.locator(".room-error")).toContainText("expired", {
    timeout: 30000,
  });
  await expect(
    page.getByRole("button", { name: "Create a room", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => sessionStorage.getItem("browser-royale.room.v1")),
  ).toBeNull();
  expect(errors).toEqual([]);
});

test("an explicit different invite keeps its code instead of resuming the old room", async ({
  page,
}) => {
  let sockets = 0;
  page.on("websocket", (socket) => {
    if (socket.url().endsWith("/battle")) sockets++;
  });
  await page.addInitScript(() =>
    sessionStorage.setItem(
      "browser-royale.room.v1",
      JSON.stringify({ code: "ABC234", token: "0".repeat(64) }),
    ),
  );
  await page.goto("/?room=ZZZ234");
  await expect(page.getByLabel("ROOM CODE", { exact: true })).toHaveValue(
    "ZZZ234",
  );
  await expect(
    page.getByRole("button", { name: "Reconnect to your room", exact: true }),
  ).toBeVisible();
  expect(sockets).toBe(0);
});

test("a failed graphics download offers a working retry", async ({ page }) => {
  await page.route(graphics, (route) =>
    route.fulfill({
      status: 503,
      contentType: "text/javascript",
      headers: { "cache-control": "no-store" },
      body: "",
    }),
  );
  await page.goto("/");
  await expect(page.locator("#startup")).toContainText(
    "Couldn’t load the arena.",
  );
  await page.unroute(graphics);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.locator("#battle-button")).toBeVisible({ timeout: 30000 });
});

test("an unsupported graphics device retains the WebGL recovery guidance", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      kind: string,
      ...args: any[]
    ) {
      if (/webgl/i.test(kind)) return null;
      return (get as any).call(this, kind, ...args);
    } as any;
  });
  await page.goto("/");
  await expect(page.locator(".webgl-error")).toContainText(
    "browser with WebGL support",
  );
  await expect(page.locator("#startup")).toHaveCount(0);
});
