import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";
import { expectedAnimations, expectedEffects } from "./native-assets";

test.use({ serviceWorkers: "block" });
async function compare(
  page: Page,
  canvas: string,
  toggle: string,
  info: import("@playwright/test").TestInfo,
) {
  const before = await page.locator(canvas).screenshot();
  await page.evaluate(
    (name) => (window as any)[name].setExpanded(true),
    toggle,
  );
  await page.waitForTimeout(150);
  const reference = await page.locator(canvas).screenshot();
  await info.attach("packed", { body: before, contentType: "image/png" });
  await info.attach("expanded", { body: reference, contentType: "image/png" });
  expect(await sharp(before).raw().toBuffer()).toEqual(
    await sharp(reference).raw().toBuffer(),
  );
}

test("packed swarm geometry uses fewer bytes and renders the original triangles", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/tests/fixtures/performance.html?swarms=8&fixedTime=3");
  await expect
    .poll(
      () =>
        page.evaluate(
          () => (window as any).__arenaProfile?.state.loadedAnimations,
        ),
      { timeout: 120000 },
    )
    .toBe(expectedAnimations);
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__arenaProfile.state.ready),
      { timeout: 120000 },
    )
    .toBe(true);
  const state = await page.evaluate(() => (window as any).__arenaProfile.state);
  expect(state.entities).toBe(126);
  expect(state.nativeGeometry.bytes).toBeLessThan(
    state.nativeGeometry.triangleVertices * 48 * 0.7,
  );
  expect(state.nativeGeometry.vertices).toBeLessThan(
    state.nativeGeometry.triangleVertices * 0.65,
  );
  await compare(page, "#arena canvas", "__arenaProfile", info);
  expect(errors).toEqual([]);
});

test("packed native particle batches preserve per-instance opacity and blend pixels", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/tests/fixtures/combat.html");
  await expect
    .poll(() => page.evaluate(() => (window as any).__geometryLayout?.ready), {
      timeout: 60000,
    })
    .toBe(true);
  await page.locator("#scenario").selectOption("death");
  await expect(page.locator("#status")).toContainText(
    `${expectedEffects} effects`,
    { timeout: 60000 },
  );
  await page.locator("#defeat").click();
  for (let i = 0; i < 3; i++) await page.locator("#step").click();
  await expect(page.locator("#death-stats")).toContainText("60 deaths");
  await expect
    .poll(async () =>
      Number(
        (await page.locator("#death-stats").textContent())!.match(
          /(\d+) native particles/,
        )![1],
      ),
    )
    .toBeGreaterThanOrEqual(960);
  await compare(page, "#arena canvas", "__geometryLayout", info);
  expect(errors).toEqual([]);
});
