import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

test("native elixir binds costs, freezes spend feedback, and shows full-bar and x3 artwork", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/elixir.html");
  await expect(page.locator("#status")).toContainText("8 native clips", {
    timeout: 30000,
  });
  const meter = page.getByRole("meter", { name: "Elixir", exact: true });
  await expect(meter).toHaveAttribute("aria-valuenow", "5");
  await expect(meter.locator('.elixir-art [data-binding^="d"]')).toHaveCount(9);
  await page.locator("#cost").selectOption("7");
  await expect(meter).toHaveClass(/insufficient/);
  await page
    .getByRole("button", { name: "Spend selected", exact: true })
    .click();
  await expect(meter).toHaveAttribute("aria-valuenow", "5");
  await page.locator("#cost").selectOption("3");
  await page
    .getByRole("button", { name: "Spend selected", exact: true })
    .click();
  await expect(meter).toHaveAttribute("aria-valuenow", "2");
  await expect(meter.locator(".elixir-floats text")).toHaveText("-3");
  const held = await meter.innerHTML();
  await page.waitForTimeout(200);
  expect(await meter.innerHTML()).toBe(held);
  await page.getByRole("button", { name: "Step 1 frame", exact: true }).click();
  await expect.poll(() => meter.innerHTML()).not.toBe(held);
  await page.getByRole("slider", { name: "Elixir", exact: true }).fill("10");
  await page.locator("#rate").selectOption("3");
  for (let i = 0; i < 15; i++)
    await page
      .getByRole("button", { name: "Step 1 frame", exact: true })
      .click();
  await expect(meter).toHaveClass(/full/);
  await expect(meter.locator(".elixir-warning text")).toHaveText(
    "Elixir bar is full!",
  );
  await expect(page.locator("#elixir-rate text")).toHaveText("x3");
  await expect(meter.locator(".elixir-art")).toHaveAttribute(
    "aria-label",
    "10 elixir",
  );
  await expect(page.locator("#status")).toContainText("0.50s");
  const full = await meter.innerHTML();
  await page.waitForTimeout(200);
  expect(await meter.innerHTML()).toBe(full);
});

test("battle elixir follows actual deployment and pauses without mutating the HUD", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__arena?.state.loadedElixir),
      { timeout: 30000 },
    )
    .toBe(8);
  await page.locator("#battle-button").click();
  await expect(page.locator("#hand .game-card").first()).toBeEnabled({
    timeout: 15000,
  });
  const card = await page.locator("#hand .game-card").evaluateAll(
    (els) =>
      els
        .map((e) => ({
          slot: (e as HTMLElement).dataset.slot,
          cost: Number(e.querySelector(".cost")!.textContent),
        }))
        .sort((a, b) => a.cost - b.cost)[0],
  );
  await page.locator(`[data-slot="${card.slot}"]`).click();
  const meter = page.locator("#elixir-hud");
  await expect(meter).toHaveAttribute("data-cost", String(card.cost));
  const before = Number(await meter.getAttribute("aria-valuenow"));
  const actions = await page.evaluate(
    () => (window as any).__arena.state.actions,
  );
  const point = await page.evaluate(() =>
    (window as any).__arena.project(4, 23),
  );
  await page.mouse.click(point.x, point.y);
  await expect
    .poll(() => page.evaluate(() => (window as any).__arena.state.actions))
    .toBeGreaterThan(actions);
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  await expect(meter).toHaveAttribute("data-cost", "0");
  const after = Number(await meter.getAttribute("aria-valuenow"));
  expect(before - after).toBeGreaterThan(card.cost - 0.5);
  await expect(meter.locator(".elixir-floats text")).toHaveText(
    `-${card.cost}`,
  );
  // Observe only the HUD DOM; no test writes to game state.
  const changes = await meter.evaluate(
    (e) =>
      new Promise<number>((resolve) => {
        let count = 0;
        const observer = new MutationObserver(
          (records) => (count += records.length),
        );
        observer.observe(e, {
          subtree: true,
          childList: true,
          attributes: true,
          characterData: true,
        });
        setTimeout(() => {
          observer.disconnect();
          resolve(count);
        }, 200);
      }),
  );
  expect(changes).toBe(0);
  expect(errors).toEqual([]);
});

test("native elixir survives replay seeking and all phone rotations with readable digits", async ({
  page,
}, info) => {
  const replay = JSON.parse(
    readFileSync("tests/fixtures/combat-v4-replay.json", "utf8"),
  ).replay;
  await page.addInitScript(
    (replay) =>
      localStorage.setItem(
        "browser-royale.profile.v1",
        JSON.stringify({
          version: 1,
          name: "Sir Teo",
          sound: false,
          seenTutorial: true,
          history: [
            {
              id: 1,
              date: "2026-10-22T12:00:00Z",
              mode: "classic",
              winner: "draw",
              crowns: [0, 0],
              replay,
            },
          ],
        }),
      ),
    { ...replay, version: 5, duration: 9000, actions: [] },
  );
  await page.goto("/");
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__arena?.state.loadedElixir),
      { timeout: 30000 },
    )
    .toBe(8);
  await page.getByRole("button", { name: "Battle log", exact: true }).click();
  await page.locator('[data-replay="0"]').click();
  await page.getByRole("button", { name: "Pause replay", exact: true }).click();
  const seek = page.getByRole("slider", { name: "Replay timeline" }),
    meter = page.locator("#elixir-hud");
  await seek.fill("50");
  await expect(page.locator("#elixir-rate text")).toHaveText("x2");
  await seek.fill("83");
  await expect(page.locator("#elixir-rate text")).toHaveText("x3");
  await expect(meter).toHaveAttribute("aria-valuenow", "10");
  await expect(meter.locator(".elixir-floats > div")).toHaveCount(0);
  const sizes =
    info.project.name === "desktop"
      ? [{ width: 1440, height: 900 }]
      : [
          { width: 320, height: 568 },
          { width: 360, height: 640 },
          { width: 375, height: 667 },
          { width: 390, height: 844 },
          { width: 667, height: 375 },
          { width: 844, height: 390 },
        ];
  for (const size of sizes) {
    await page.setViewportSize(size);
    const narrow = size.width > size.height && size.height < 540;
    await expect(meter.locator(".elixir-art > svg")).toHaveAttribute(
      "viewBox",
      narrow ? "-44 -27 254 62" : "-44 -27 454 62",
    );
    const bounds = await meter.evaluate((e) => {
      const box = (n: Element) => {
        const b = n.getBoundingClientRect();
        return {
          x: b.x,
          y: b.y,
          right: b.right,
          bottom: b.bottom,
          height: b.height,
        };
      };
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        controls: [
          ...document.querySelectorAll(
            "#hand .game-card,#pause-button,.replay-controls",
          ),
        ].map(box),
        digit: box(
          e.querySelector(
            '[data-binding="elixirBarLeftNumbers/elixirAmount/txt"] text',
          )!,
        ),
        rate: box(document.querySelector("#elixir-rate")!),
      };
    });
    expect(bounds.overflow).toBe(false);
    expect(bounds.digit.height).toBeGreaterThan(15);
    for (const b of [...bounds.controls, bounds.digit, bounds.rate]) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.right).toBeLessThanOrEqual(size.width + 1);
      expect(b.bottom).toBeLessThanOrEqual(size.height + 1);
    }
    if (
      size.width === 390 ||
      size.width === 667 ||
      info.project.name === "desktop"
    )
      await page.screenshot({
        path: `test-results/${info.project.name}-native-elixir-${size.width}.png`,
      });
  }
  await seek.fill("0");
  await expect(meter).toHaveAttribute("aria-valuenow", "5");
  await expect(page.locator("#elixir-rate")).toBeHidden();
});
