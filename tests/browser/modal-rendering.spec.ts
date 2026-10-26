import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";

test.use({ serviceWorkers: "block", actionTimeout: 20000 });
test.setTimeout(150000);
const key = "browser-royale.profile.v1";
const state = (page: Page) =>
  page.evaluate(() => (window as any).__arena.state);
// Isolate arena pixels from the dialog's SVG/text and backdrop compositor.
const arenaPixels = (page: Page, path?: string) =>
  page.locator("#arena-canvas canvas").screenshot({
    path,
    style: "#modal-root, #toast { visibility: hidden !important; }",
    animations: "disabled",
  });
const game = (s: any) => ({
  screen: s.screen,
  time: s.time,
  units: s.units,
  hand: s.hand,
  elixir: s.elixir,
  actions: s.actions,
});

async function open(page: Page) {
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
  await page.waitForFunction(
    () => {
      const s = (window as any).__arena?.state;
      return s && !s.renderPending;
    },
    null,
    { timeout: 90000 },
  );
  await page.locator("#deck-preview [data-card-info]").first().click();
  await expect(page.locator(".detail-art.native-card-ready")).toBeVisible({
    timeout: 30000,
  });
  await page.evaluate(() => document.fonts.ready);
  return quiet(page);
}

async function quiet(page: Page) {
  await expect
    .poll(
      async () => {
        const s = await state(page);
        return !s.renderPending && s.fps === 0;
      },
      { timeout: 60000 },
    )
    .toBe(true);
  const before = await state(page);
  await page.waitForTimeout(350);
  const after = await state(page);
  expect(after.renderedFrames).toBe(before.renderedFrames);
  expect(after.animationTime).toBe(before.animationTime);
  expect(after.destruction.time).toBe(before.destruction.time);
  expect(game(after)).toEqual(game(before));
  expect(after.frameLoopRunning).toBe(true);
  expect(after.paused).toBe(false);
  return after;
}

async function close(page: Page, held: any) {
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect
    .poll(async () => (await state(page)).renderedFrames)
    .toBeGreaterThan(held.renderedFrames);
  await expect
    .poll(async () => (await state(page)).animationTime)
    .toBeGreaterThan(held.animationTime);
  expect(game(await state(page))).toEqual(game(held));
}

test("lobby dialogs retain the arena while navigation, resize and page restoration stay live", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const held = await open(page);
  const saved = await page.evaluate((key) => localStorage.getItem(key), key);
  const canvas = page.locator("#arena-canvas canvas");
  const pixels = await arenaPixels(page, info.outputPath("arena-held.png"));
  await page.evaluate(() => {
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("pageshow"));
  });
  await expect
    .poll(async () => (await state(page)).renderedFrames)
    .toBeGreaterThan(held.renderedFrames);
  const shown = await quiet(page);
  expect(shown.animationTime).toBe(held.animationTime);
  expect(shown.destruction.time).toBe(held.destruction.time);
  expect(
    (await arenaPixels(page, info.outputPath("arena-shown.png"))).equals(
      pixels,
    ),
  ).toBe(true);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect
    .poll(async () => (await state(page)).renderedFrames)
    .toBeGreaterThan(shown.renderedFrames);
  const reduced = await quiet(page);
  const box = await canvas.boundingBox();
  await page.setViewportSize(
    info.project.name === "desktop"
      ? { width: 780, height: 640 }
      : { width: 320, height: 568 },
  );
  await expect
    .poll(async () => (await state(page)).renderedFrames)
    .toBeGreaterThan(reduced.renderedFrames);
  const resized = await quiet(page);
  expect(await canvas.boundingBox()).not.toEqual(box);
  expect(resized.animationTime).toBe(held.animationTime);
  expect(game(resized)).toEqual(game(held));

  await page
    .getByRole("button", { name: "Open deck builder", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Search cards", exact: true })
    .fill("Witch");
  await page.locator('[data-collection="witch"]').click();
  await expect(page.locator('[data-card-stat="Troop spacing"] b')).toHaveText(
    "0.3 s",
  );
  await page
    .locator('[data-card-stat="Troop spacing"]')
    .scrollIntoViewIfNeeded();
  expect(
    await page
      .locator(".modal")
      .evaluate((el) => el.scrollWidth > el.clientWidth),
  ).toBe(false);
  const browsed = await quiet(page);
  expect(browsed.renderedFrames).toBe(resized.renderedFrames);
  await page.screenshot({
    path: info.outputPath("retained-lobby-dialog.png"),
    animations: "disabled",
  });
  await close(page, browsed);
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    saved,
  );
  expect(errors).toEqual([]);
});

test("a lobby dialog survives real WebGL loss and restores the held arena pose", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const held = await open(page);
  const canvas = page.locator("#arena-canvas canvas");
  const pixels = await arenaPixels(page, info.outputPath("arena-held.png"));
  expect(
    await canvas.evaluate((canvas) => {
      const extension = (canvas as HTMLCanvasElement)
        .getContext("webgl2")
        ?.getExtension("WEBGL_lose_context");
      (window as any).__modalContext = extension;
      extension?.loseContext();
      return !!extension;
    }),
  ).toBe(true);
  await expect
    .poll(async () => (await state(page)).graphicsAvailable)
    .toBe(false);
  expect(game(await state(page))).toEqual(game(held));
  await page.evaluate(() => (window as any).__modalContext.restoreContext());
  await expect
    .poll(async () => (await state(page)).graphicsAvailable, { timeout: 45000 })
    .toBe(true);
  await expect
    .poll(async () => (await state(page)).renderedFrames)
    .toBeGreaterThan(held.renderedFrames);
  const restored = await quiet(page);
  await expect(page.locator("#toast")).toHaveText("Arena graphics restored.");
  expect(game(restored)).toEqual(game(held));
  expect(restored.animationTime).toBe(held.animationTime);
  expect(restored.destruction.time).toBe(held.destruction.time);
  const repainted = await arenaPixels(
    page,
    info.outputPath("arena-restored.png"),
  );
  const before = await sharp(pixels)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const after = await sharp(repainted)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect(after.info).toEqual(before.info);
  // Recreated GPU resources may round a color channel by one 8-bit value.
  let maxChannelDelta = 0;
  for (let i = 0; i < before.data.length; i++)
    maxChannelDelta = Math.max(
      maxChannelDelta,
      Math.abs(before.data[i] - after.data[i]),
    );
  expect(maxChannelDelta).toBeLessThanOrEqual(1);
  await expect(page.locator(".detail-art.native-card-ready")).toBeVisible();
  await close(page, restored);
  expect(errors).toEqual([]);
});
