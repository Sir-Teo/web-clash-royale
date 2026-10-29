import { test, expect } from "@playwright/test";
import { expectedHealth, expectedHealthRoots } from "./native-assets";
import { CARD_MAP } from "../../src/game/cards";

test("source health fills stay independent of King activation frames", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/tests/fixtures/health.html");
  await expect(page.locator("#status")).toContainText(`${expectedHealthRoots} native roots`, {
    timeout: 30000,
  });
  const king = page.locator('[data-name="hp_player_wizard"]');
  await expect(king.locator("text")).toHaveText(["11", "5232"]);
  await page.locator("#health").fill("50");
  await expect(king.locator("text")).toHaveText(["11", "2616"]);
  await expect(page.locator("#status")).toContainText("health state 50");
  await page.locator("#frame").fill("0");
  await expect(king.locator("text")).toHaveText("11");
  await page.locator("#frame").fill("31");
  await expect(king.locator("text")).toHaveText(["11", "2616"]);
  await page.locator("#health").fill("0");
  await expect(king.locator("text")).toHaveText(["11", "0"]);
  expect(errors).toEqual([]);
});

test("native health tracks damage, freezes, survives a paused rebuild, and clears after deaths", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/tests/fixtures/health-arena.html");
  await expect(page.locator("#status")).toContainText(`${expectedHealth} health clips`, {
    timeout: 30000,
  });
  await expect(page.locator("#status")).toContainText("10 troop HUDs");
  const positions = () => page.locator("#units").getAttribute("data-positions");
  const initial = JSON.parse((await positions())!);
  expect(
    new Set(initial.map((p: number[]) => p.join(","))).size,
  ).toBeGreaterThan(6);
  expect(
    initial.every(([x, y]: number[]) => Math.abs(x - 9) + Math.abs(y - 16) > 2),
  ).toBe(true);
  await page.locator("#damage").click();
  await expect(page.locator("#units")).toContainText("player_small:25");
  await expect(page.locator("#units")).toContainText("player_medium:25");
  await expect(page.locator("#units")).toContainText("enemy_high:25");
  await page.locator("#wake").click();
  await page.locator("#second").click();
  await expect(page.locator("#status")).toContainText("Kings 25/25");
  const king = page.locator('[data-health-kind="king"]').first();
  await expect(king).toHaveAttribute(
    "aria-valuenow",
    "5155",
  );
  const held = await page.locator(".tower-labels").innerHTML();
  await page.waitForTimeout(200);
  expect(await page.locator(".tower-labels").innerHTML()).toBe(held);
  await page.locator("#second").click();
  await expect(page.locator("#status")).toContainText("Kings 31/31");
  const before = await positions();
  await page.locator("#rebuild").click();
  await expect(page.locator("#units")).toHaveAttribute(
    "data-positions",
    before!,
  );
  await expect(page.locator("#status")).toContainText("Kings 31/31");
  await page.screenshot({
    path: `test-results/${info.project.name}-native-health-arena.png`,
  });
  await page.locator("#defeat").click();
  await expect(page.locator("#status")).toContainText("0 troop HUDs");
  await page.locator("#reset").click();
  await expect(page.locator("#status")).toContainText("Kings 0/0");
  await expect(page.locator("#status")).toContainText("10 troop HUDs");
  for (let i = 0; i < 2; i++) await page.locator("#second").click();
  await expect(page.locator("#status")).toContainText("0 troop HUDs");
  expect(errors).toEqual([]);
});

test("health labels remain readable and inside the arena across phone rotations", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__arena?.state.loadedHealth),
      { timeout: 30000 },
    )
    .toBe(expectedHealth);
  await page.locator("#battle-button").click();
  await expect(page.locator("#hand .game-card").first()).toBeEnabled({
    timeout: 15000,
  });
  await expect(page.locator("#battle-intro")).toHaveClass(/hidden/);
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  await expect(page.locator(".native-health-ready")).toHaveCount(6);
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
    await expect
      .poll(async () =>
        page.locator(".native-health-ready").evaluateAll((els) => {
          const arena = document
            .querySelector("#arena-canvas")!
            .getBoundingClientRect();
          return els.every((e) => {
            const b = e.getBoundingClientRect();
            return (
              b.left >= arena.left - 1 &&
              b.right <= arena.right + 1 &&
              b.top >= arena.top - 1 &&
              b.bottom <= arena.bottom + 1
            );
          });
        }),
      )
      .toBe(true);
    const heights = await page
      .locator('[data-health-kind="princess"] .native-health-art text')
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    for (const h of heights) expect(h).toBeGreaterThan(11);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    if (
      size.width === 390 ||
      size.width === 667 ||
      info.project.name === "desktop"
    )
      await page.screenshot({
        path: `test-results/${info.project.name}-native-health-${size.width}.png`,
        // Preserve the paused scene while exposing its HUD for visual review.
        style: ".pause-cover { visibility: hidden !important; }",
      });
  }
  // A rotation may deliver its ResizeObserver callback after the viewport call.
  // Once it settles, a paused frame must stop writing to the tower HUD entirely.
  await expect
    .poll(() =>
      page.locator(".tower-labels").evaluate(
        (e) =>
          new Promise<number>((resolve) => {
            let changes = 0;
            const o = new MutationObserver((r) => (changes += r.length));
            o.observe(e, {
              subtree: true,
              attributes: true,
              childList: true,
              characterData: true,
            });
            setTimeout(() => {
              o.disconnect();
              resolve(changes);
            }, 200);
          }),
      ),
    )
    .toBe(0);
  expect(errors).toEqual([]);
});

test("health asset failure preserves fallback bars and a playable battle", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/assets/ui/health/health.json", (r) => r.abort());
  await page.goto("/");
  await page.locator("#battle-button").click();
  await expect(page.locator("#hand .game-card").first()).toBeEnabled({
    timeout: 15000,
  });
  await expect(page.locator(".tower-health")).toHaveCount(6);
  await expect(page.locator(".native-health-ready")).toHaveCount(0);
  await expect(page.locator(".tower-health > span").first()).toHaveText(
    "3,052",
  );
  expect(errors).toEqual([]);
});
