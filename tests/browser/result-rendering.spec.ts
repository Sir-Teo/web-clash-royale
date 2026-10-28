import { test, expect, type Page } from "@playwright/test";
import {
  expectedAnimations,
  expectedCards,
  expectedEffects,
} from "./native-assets";

test.use({ serviceWorkers: "block" });
test.setTimeout(150000);
const key = "browser-royale.profile.v1";
const state = (page: Page) =>
  page.evaluate(() => (window as any).__arena?.state ?? {});
const game = (s: any) => ({
  time: s.time,
  units: s.units,
  hand: s.hand,
  elixir: s.elixir,
  actions: s.actions,
  winner: s.winner,
});
const pixels = (page: Page) =>
  page.locator("#arena-canvas canvas").screenshot({
    style: "#modal-root, #toast { visibility: hidden !important; }",
    animations: "disabled",
  });
async function result(page: Page) {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript((key) => {
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        seenTutorial: true,
        sound: false,
        music: false,
      }),
    );
  }, key);
  await page.goto("/");
  await expect
    .poll(
      async () => {
        const s = await state(page);
        return [
          s.loadedAnimations,
          s.loadedCards,
          s.loadedEffects,
          s.loadedEndings,
          s.renderPending,
        ];
      },
      { timeout: 90000 },
    )
    .toEqual([expectedAnimations, expectedCards, expectedEffects, 5, false]);
  await page.locator("#battle-button").click();
  await expect
    .poll(async () => (await state(page)).intro.blocking, { timeout: 30000 })
    .toBe(false);
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  await page.getByRole("button", { name: "Leave battle", exact: true }).click();
  await expect(page.locator("#return-home")).toBeVisible({ timeout: 20000 });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}
async function quiet(page: Page) {
  await expect.poll(async () => (await state(page)).renderPending).toBe(false);
  const before = await state(page);
  await page.waitForTimeout(400);
  const after = await state(page);
  expect(after.renderedFrames).toBe(before.renderedFrames);
  expect(after.destruction.time).toBe(before.destruction.time);
  expect(after.animationTime).toBe(before.animationTime);
  expect(game(after)).toEqual(game(before));
  expect(after.fps).toBe(0);
  expect(after.frameLoopRunning).toBe(true);
  return after;
}

test("the result dialog retains its arena and redraws on page restoration, reduced motion and resize", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await result(page);
  const held = await quiet(page);
  const saved = await page.evaluate((key) => localStorage.getItem(key), key);
  const original = await pixels(page);
  await page.waitForTimeout(400);
  expect((await pixels(page)).equals(original)).toBe(true);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("pageshow"));
  });
  await expect
    .poll(async () => (await state(page)).renderedFrames)
    .toBeGreaterThan(held.renderedFrames);
  const shown = await quiet(page);
  expect(game(shown)).toEqual(game(held));
  expect((await pixels(page)).equals(original)).toBe(true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect
    .poll(async () => (await state(page)).renderedFrames)
    .toBeGreaterThan(shown.renderedFrames);
  const reduced = await quiet(page);
  await page.setViewportSize(
    info.project.name === "desktop"
      ? { width: 780, height: 640 }
      : { width: 320, height: 568 },
  );
  await expect
    .poll(async () => (await state(page)).renderedFrames)
    .toBeGreaterThan(reduced.renderedFrames);
  const resized = await quiet(page);
  expect(game(resized)).toEqual(game(held));
  await page.screenshot({
    path: info.outputPath("resting-result.png"),
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Watch replay", exact: true }).click();
  await expect
    .poll(async () => (await state(page)).renderedFrames)
    .toBeGreaterThan(resized.renderedFrames);
  await expect.poll(async () => (await state(page)).screen).toBe("replay");
  await page.locator("#replay-exit").click();
  const lobby = await state(page);
  await expect
    .poll(async () => (await state(page)).renderedFrames)
    .toBeGreaterThan(lobby.renderedFrames);
  expect((await state(page)).screen).toBe("lobby");
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    saved,
  );
  expect(errors).toEqual([]);
});

test("a result survives WebGL recovery, then Battle again starts a live arena", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await result(page);
  const held = await quiet(page);
  const saved = await page.evaluate((key) => localStorage.getItem(key), key);
  expect(
    await page.locator("#arena-canvas canvas").evaluate((element) => {
      const extension = (element as HTMLCanvasElement)
        .getContext("webgl2")
        ?.getExtension("WEBGL_lose_context");
      (window as any).__resultContext = extension;
      extension?.loseContext();
      return !!extension;
    }),
  ).toBe(true);
  await expect
    .poll(async () => (await state(page)).graphicsAvailable)
    .toBe(false);
  expect(game(await state(page))).toEqual(game(held));
  await page.evaluate(() => (window as any).__resultContext.restoreContext());
  await expect
    .poll(async () => (await state(page)).graphicsAvailable, { timeout: 45000 })
    .toBe(true);
  const restored = await quiet(page);
  expect(game(restored)).toEqual(game(held));
  expect(restored.destruction.time).toBe(held.destruction.time);
  await expect(page.locator("#return-home")).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    saved,
  );
  await page.getByRole("button", { name: "Battle again", exact: true }).click();
  await expect.poll(async () => (await state(page)).winner).toBeNull();
  await expect
    .poll(async () => (await state(page)).renderedFrames)
    .toBeGreaterThan(restored.renderedFrames);
  expect((await state(page)).destruction.time).toBeLessThan(3);
  await expect
    .poll(async () => (await state(page)).intro.blocking, { timeout: 30000 })
    .toBe(false);
  await expect.poll(async () => (await state(page)).time).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
