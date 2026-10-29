import { test, expect, chromium, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { CARD_MAP, type CardId } from "../../src/game/cards";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block", actionTimeout: 20000 });
test.describe.configure({ timeout: 180000 });
const key = "browser-royale.profile.v1";
const state = (page: Page) =>
  page.evaluate(() => (window as any).__arena?.state);
const saved = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
async function init(page: Page, history: unknown[] = []) {
  await page.addInitScript(
    ({ key, history }) =>
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          name: "Recovery King",
          seenTutorial: true,
          sound: false,
          music: false,
          history,
        }),
      ),
    { key, history },
  );
  await page.goto("/");
  await expect
    .poll(async () => (await state(page))?.loadedCards, { timeout: 60000 })
    .toBe(expectedCards);
}
async function lose(page: Page) {
  const supported = await page
    .locator("#arena-canvas canvas")
    .evaluate((canvas) => {
      const gl = (canvas as HTMLCanvasElement).getContext("webgl2");
      const extension = gl?.getExtension("WEBGL_lose_context");
      (window as any).__graphicsRecoveryTest = {
        gl,
        extension,
        restorationHeld: null,
      };
      canvas.addEventListener(
        "webglcontextrestored",
        () => {
          (window as any).__graphicsRecoveryTest.restorationHeld = !(
            window as any
          ).__arena.state.graphicsAvailable;
        },
        { once: true },
      );
      extension?.loseContext();
      return !!extension;
    });
  expect(supported).toBe(true);
  await expect
    .poll(async () => (await state(page)).graphicsAvailable)
    .toBe(false);
  expect(
    await page.evaluate(() =>
      (window as any).__graphicsRecoveryTest.gl.isContextLost(),
    ),
  ).toBe(true);
}
async function restore(page: Page) {
  await page.evaluate(() =>
    (window as any).__graphicsRecoveryTest.extension.restoreContext(),
  );
  await expect
    .poll(async () => (await state(page)).graphicsAvailable, { timeout: 45000 })
    .toBe(true);
  expect(
    await page.evaluate(
      () => (window as any).__graphicsRecoveryTest.restorationHeld,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() =>
      (window as any).__graphicsRecoveryTest.gl.isContextLost(),
    ),
  ).toBe(false);
  await expect(page.locator("#graphics-warning")).toBeHidden();
}
async function start(page: Page) {
  await page.locator("#battle-button").click();
  await expect
    .poll(async () => (await state(page)).intro.blocking, { timeout: 15000 })
    .toBe(false);
}
async function freeze(page: Page, milliseconds = 600) {
  const before = await state(page);
  await page.waitForTimeout(milliseconds);
  const after = await state(page);
  expect(after.time).toBe(before.time);
  expect(after.elixir).toBe(before.elixir);
  expect(after.actions).toBe(before.actions);
  return before;
}

test("real context loss blocks lobby starts and a dismissed solo pause cannot advance blind combat", async ({
  page,
}, info) => {
  await init(page);
  await lose(page);
  await expect(page.locator("#battle-button")).toBeDisabled();
  expect((await state(page)).screen).toBe("lobby");
  await expect(page.locator("#graphics-warning")).toContainText(
    "Waiting for the arena",
  );
  await restore(page);
  await start(page);
  await page.locator("#arena-canvas canvas").focus();
  await page.keyboard.press("1");
  expect((await state(page)).selected).toBe(0);
  await lose(page);
  await expect(
    page.getByRole("dialog", { name: "Battle paused", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#resume-button")).toBeDisabled();
  await expect(page.locator("#graphics-pause-note")).toContainText(
    "Graphics interrupted",
  );
  expect((await state(page)).selected).toBe(-1);
  await expect(page.locator("#hand-caption")).toHaveText(
    "Select a card, then tap your side of the arena",
  );
  await freeze(page);
  if (info.project.name !== "mobile")
    await page.screenshot({
      path: info.outputPath("graphics-solo-paused.png"),
      animations: "disabled",
    });
  await page.keyboard.press("Escape");
  await page.locator("#arena-canvas canvas").focus();
  await page.keyboard.press("1");
  await page.keyboard.press("Enter");
  expect((await state(page)).selected).toBe(-1);
  for (const hand of await page.locator("[data-slot]").all())
    await expect(hand).toBeDisabled();
  const frozen = await freeze(page);
  await restore(page);
  expect((await state(page)).selected).toBe(-1);
  await expect(page.locator("#hand-caption")).toHaveText(
    "Select a card, then tap your side of the arena",
  );
  await expect
    .poll(async () => (await state(page)).time)
    .toBeGreaterThan(frozen.time);
  if (info.project.name === "desktop")
    await page.screenshot({
      path: info.outputPath("graphics-solo-restored.png"),
      animations: "disabled",
    });
  expect((await saved(page)).history).toEqual([]);
});

test("restoring graphics preserves a manually paused solo battle and its resume focus", async ({
  page,
}) => {
  await init(page);
  await start(page);
  await page.locator("#pause-button").click();
  await lose(page);
  await freeze(page);
  await restore(page);
  expect((await state(page)).paused).toBe(true);
  await expect(page.locator("#resume-button")).toBeEnabled();
  await expect(page.locator("#graphics-pause-note")).toHaveText(
    "Graphics restored. Resume when ready.",
  );
  const frozen = await freeze(page);
  await page.locator("#resume-button").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#arena-canvas canvas")).toBeFocused();
  await expect
    .poll(async () => (await state(page)).time)
    .toBeGreaterThan(frozen.time);
  await lose(page);
  await page.locator("#surrender-button").click();
  await expect(page.locator("#return-home")).toBeVisible();
  expect((await state(page)).graphicsAvailable).toBe(false);
  const completed = await saved(page);
  expect(completed.history).toHaveLength(1);
  await page.locator("#return-home").click();
  expect((await state(page)).screen).toBe("lobby");
  await expect(page.locator("#battle-button")).toBeDisabled();
  await restore(page);
  await expect(page.locator("#battle-button")).toBeEnabled();
  expect(await saved(page)).toEqual(completed);
});

test("a paused red-side replay survives real graphics recovery without changing progress or speed", async ({
  page,
}) => {
  const replay = JSON.parse(
    readFileSync("tests/fixtures/combat-v4-replay.json", "utf8"),
  ).replay;
  await init(page, [
    {
      id: 42,
      date: "2026-10-25T00:00:00.000Z",
      mode: replay.mode,
      winner: "blue",
      crowns: [3, 0],
      opponent: "Other King",
      opponentType: "friend",
      replay: { ...replay, perspective: "red" },
    },
  ]);
  const before = await saved(page);
  await page.getByRole("button", { name: "Battle log", exact: true }).click();
  await page.locator("[data-replay]").click();
  await page.locator("#replay-play").click();
  await page.locator("#replay-forward").click();
  await page.locator("#replay-speed").click();
  const frozen = await state(page);
  await lose(page);
  await freeze(page);
  await restore(page);
  expect((await state(page)).paused).toBe(true);
  expect((await state(page)).time).toBe(frozen.time);
  await expect(page.locator("#replay-speed")).toHaveText("2×");
  await page.locator("#replay-play").click();
  await expect
    .poll(async () => (await state(page)).time)
    .toBeGreaterThan(frozen.time);
  await page.locator("#replay-exit").click();
  expect(await saved(page)).toEqual(before);
});

for (const role of ["host", "guest"] as const)
  test(`real ${role} graphics loss pauses both friendly browsers through heartbeats and recovers the same match`, async ({
    page: projectPage,
    browser,
    browserName,
  }, info) => {
    test.setTimeout(240000);
    const counterpart =
      browserName === "webkit"
        ? await chromium.launch({
            args: [
              "--enable-webgl",
              "--use-gl=angle",
              "--use-angle=swiftshader",
              "--enable-unsafe-swiftshader",
              // Container WebKit cannot resolve Chromium's masked local ICE names.
              "--disable-features=WebRtcHideLocalIpsWithMdns",
            ],
          })
        : undefined;
    const context = await (counterpart ?? browser).newContext({
      ...info.project.use,
      baseURL: "http://127.0.0.1:5188",
      serviceWorkers: "block",
    } as any);
    const other = await context.newPage();
    const [host, guest] =
      role === "host" ? [projectPage, other] : [other, projectPage];
    const errors: string[] = [];
    try {
      for (const p of [host, guest]) {
        p.on("pageerror", (error) => errors.push(error.message));
        if (info.project.name !== "desktop")
          await p.setViewportSize({ width: 320, height: 740 });
        await init(p);
        await p.locator("#friend-button").click();
      }
      await host.locator("#create-peer").click();
      await expect(host.locator("#peer-share")).toHaveValue(/^CR1\./, {
        timeout: 30000,
      });
      await guest
        .locator("#peer-invite")
        .fill(await host.locator("#peer-share").inputValue());
      await guest.locator('#peer-join-form button[type="submit"]').click();
      await expect(guest.locator("#peer-share")).toHaveValue(/^CR1\./, {
        timeout: 30000,
      });
      await host
        .locator("#peer-reply")
        .fill(await guest.locator("#peer-share").inputValue());
      await host.locator('#peer-accept-form button[type="submit"]').click();
      for (const p of [host, guest]) {
        await expect(p.locator("#room-ready")).toBeEnabled({ timeout: 30000 });
        await p.locator("#room-ready").click();
      }
      for (const p of [host, guest])
        await expect
          .poll(
            async () => {
              const s = await state(p);
              return s.multiplayer?.phase === "playing" && !s.intro.blocking;
            },
            { timeout: 30000 },
          )
          .toBe(true);
      const id = (await state(host)).multiplayer.matchId;
      await lose(projectPage);
      for (const p of [host, guest])
        await expect(p.locator("#connection-status")).toContainText(
          "Battle paused",
          { timeout: 10000 },
        );
      // A visibility notification and multiple recurring heartbeats must not erase graphics unavailability.
      await projectPage.evaluate(() =>
        document.dispatchEvent(new Event("visibilitychange")),
      );
      await freeze(host, 3300);
      await freeze(guest, 100);
      await expect(projectPage.locator("#graphics-warning")).toBeVisible();
      for (const p of [host, guest]) {
        expect((await state(p)).multiplayer.connected).toBe(true);
        expect((await state(p)).multiplayer.matchId).toBe(id);
      }
      const warning = (await projectPage
        .locator("#graphics-warning")
        .boundingBox())!;
      expect(warning.x).toBeGreaterThanOrEqual(0);
      expect(warning.x + warning.width).toBeLessThanOrEqual(
        projectPage.viewportSize()!.width,
      );
      if (role === "host" && info.project.name !== "mobile")
        await projectPage.screenshot({
          path: info.outputPath("graphics-friendly-paused.png"),
          animations: "disabled",
        });
      const frozen = (await state(host)).time;
      await restore(projectPage);
      for (const p of [host, guest]) {
        await expect(p.locator("#connection-status")).toContainText(
          "FRIENDLY",
          { timeout: 10000 },
        );
        await expect
          .poll(async () => (await state(p)).time)
          .toBeGreaterThan(frozen);
        expect((await state(p)).multiplayer.matchId).toBe(id);
      }
      const current = await state(projectPage);
      const slot = current.hand.findIndex(
        (card: CardId) => CARD_MAP[card].cost <= current.elixir,
      );
      const card = current.hand[slot] as CardId;
      await projectPage.locator("#arena-canvas canvas").focus();
      await projectPage.keyboard.press(String(slot + 1));
      await expect
        .poll(async () => (await state(projectPage)).selected)
        .toBe(slot);
      await projectPage.keyboard.press("Enter");
      await expect(
        projectPage.locator("#keyboard-deployment-status"),
      ).toHaveText(`${CARD_MAP[card].name} deployed.`);
      await expect.poll(async () => (await state(host)).actions).toBe(1);
      // A later graphics loss must not trap an authoritative result behind a
      // renderer animation that can no longer advance.
      await lose(projectPage);
      await other.locator("#pause-button").click();
      await other.locator("#online-surrender").click();
      for (const p of [host, guest]) {
        await expect(p.locator("#return-home")).toBeVisible({ timeout: 20000 });
        const profile = await saved(p);
        expect(profile.history).toHaveLength(1);
        expect(profile.history[0].matchId).toBe(id);
        expect(profile.history[0].replay.actions).toHaveLength(1);
        expect(profile.gold).toBe(1000);
        expect(profile.trophies).toBe(0);
      }
      expect((await state(projectPage)).graphicsAvailable).toBe(false);
      await projectPage.locator("#return-home").click();
      expect((await state(projectPage)).screen).toBe("lobby");
      await expect(projectPage.locator("#battle-button")).toBeDisabled();
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      await counterpart?.close();
    }
  });
