import { test, expect, type Page } from "@playwright/test";
const phoneSizes = [
  { width: 320, height: 568 },
  { width: 360, height: 640 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 667, height: 375 },
  { width: 844, height: 390 },
];
async function tap(page: Page, selector: string) {
  const bounds = await page.locator(selector).boundingBox();
  expect(bounds).not.toBeNull();
  await page.touchscreen.tap(
    bounds!.x + bounds!.width / 2,
    bounds!.y + bounds!.height / 2,
  );
}
test("phone controls fit six sizes, rotate during play, and accept real touch input", async ({
  page,
  browserName,
}, info) => {
  test.skip(info.project.name === "desktop", "Real touch contexts only");
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.setViewportSize(phoneSizes[0]);
  await page.goto("/");
  await expect
    .poll(
      () =>
        page.evaluate(() => (window as any).__arena?.state.loadedAnimations),
      { timeout: 30000 },
    )
    .toBe(18);
  await page.locator("#battle-button").click();
  await expect(page.locator("#hand .game-card")).toHaveCount(4);
  for (const size of phoneSizes) {
    await page.setViewportSize(size);
    await expect
      .poll(() =>
        page
          .locator(".arena-panel")
          .evaluate((e) => Math.round(e.getBoundingClientRect().height)),
      )
      .toBe(size.height);
    await expect
      .poll(() =>
        page.locator("canvas").evaluate((e) => {
          const canvas = e as HTMLCanvasElement;
          return (
            Math.abs(
              canvas.height / Math.min(devicePixelRatio, 2) -
                canvas.getBoundingClientRect().height,
            ) < 1
          );
        }),
      )
      .toBe(true);
    const measurements = await page.evaluate(() => {
      const box = (e: Element) => {
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      };
      return {
        scrollX: scrollX,
        scrollY: scrollY,
        width: document.documentElement.scrollWidth,
        controls: [
          ...document.querySelectorAll(
            "#hand .game-card,#pause-button,#arena-settings,#elixir-number,#next-card-img",
          ),
        ].map(box),
        arena: box(document.querySelector("#arena-canvas")!),
        corners: [
          [0, 0],
          [18, 0],
          [0, 32],
          [18, 32],
        ].map(([x, y]) => (window as any).__arena.project(x, y)),
      };
    });
    expect(measurements.scrollX).toBe(0);
    expect(measurements.scrollY).toBe(0);
    expect(measurements.width).toBeLessThanOrEqual(size.width);
    for (const b of measurements.controls) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(size.width + 1);
      expect(b.y + b.h).toBeLessThanOrEqual(size.height + 1);
    }
    for (const c of measurements.corners) {
      expect(c.x).toBeGreaterThanOrEqual(measurements.arena.x);
      expect(c.x).toBeLessThanOrEqual(
        measurements.arena.x + measurements.arena.w,
      );
      expect(c.y).toBeGreaterThanOrEqual(measurements.arena.y);
      expect(c.y).toBeLessThanOrEqual(
        measurements.arena.y + measurements.arena.h,
      );
    }
    const cards = await page.locator("#hand .game-card").evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return [r.width, r.height];
      }),
    );
    for (const [w, h] of cards) {
      expect(w).toBeGreaterThanOrEqual(44);
      expect(h).toBeGreaterThanOrEqual(44);
    }
  }
  await page.setViewportSize({ width: 375, height: 667 });
  const cards = await page.locator("#hand .game-card").evaluateAll((els) =>
    els.map((e) => ({
      slot: (e as HTMLElement).dataset.slot!,
      cost: Number(e.querySelector(".cost")!.textContent),
    })),
  );
  const card = cards.sort((a, b) => a.cost - b.cost)[0];
  await tap(page, `[data-slot="${card.slot}"]`);
  await expect(page.locator(`[data-slot="${card.slot}"]`)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const before = await page.evaluate(
    () => (window as any).__arena.state.actions,
  );
  const point = await page.evaluate(() =>
    (window as any).__arena.project(4, 21),
  );
  await page.touchscreen.tap(point.x, point.y);
  await expect
    .poll(() => page.evaluate(() => (window as any).__arena.state.actions))
    .toBeGreaterThan(before);
  await tap(page, "#pause-button");
  await expect(
    page.getByRole("heading", { name: "Battle paused" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Resume battle", exact: true })
    .click();
  if (browserName === "chromium") {
    const slot = await page.evaluate(() => {
      const controls = [
        ...document.querySelectorAll<HTMLElement>("#hand .game-card"),
      ];
      return controls.find((e) => !e.classList.contains("unaffordable"))
        ?.dataset.slot;
    });
    if (slot !== undefined) {
      const b = await page.locator(`[data-slot="${slot}"]`).boundingBox();
      const end = await page.evaluate(() =>
        (window as any).__arena.project(14, 22),
      );
      const actions = await page.evaluate(
        () => (window as any).__arena.state.actions,
      );
      const cdp = await page.context().newCDPSession(page);
      const start = { x: b!.x + b!.width / 2, y: b!.y + b!.height / 2 };
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ ...start, id: 0 }],
      });
      for (let i = 1; i <= 8; i++)
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [
            {
              x: start.x + ((end.x - start.x) * i) / 8,
              y: start.y + ((end.y - start.y) * i) / 8,
              id: 0,
            },
          ],
        });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await expect
        .poll(() => page.evaluate(() => (window as any).__arena.state.actions))
        .toBeGreaterThan(actions);
      await expect(page.locator("#drag-card")).toBeHidden();
      await cdp.detach();
    }
  }
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await page.screenshot({
    path: `test-results/${info.project.name}-phone-portrait.png`,
  });
  await page.setViewportSize({ width: 667, height: 375 });
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await page.screenshot({
    path: `test-results/${info.project.name}-phone-landscape.png`,
  });
  await tap(page, "#pause-button");
  await page.getByRole("button", { name: "Leave battle", exact: true }).click();
  await page.getByRole("button", { name: "Watch replay", exact: true }).click();
  const replay = await page.locator(".replay-controls").boundingBox();
  expect(replay!.y + replay!.height).toBeLessThanOrEqual(375);
  await tap(page, "#replay-exit");
  await expect(page.locator("#battle-button")).toBeVisible();
  expect(errors).toEqual([]);
});
