import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
async function ready(page: Page) {
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__arena?.state.loadedIntros),
      { timeout: 30000 },
    )
    .toBe(2);
}

test("training uses its own native opening and player names remain literal text", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/intro.html");
  await expect(page.locator("#status")).toContainText("2 native clips", {
    timeout: 30000,
  });
  await page.getByLabel("Player name", { exact: true }).fill("<b>Teo & Co</b>");
  await page.getByLabel("Player name", { exact: true }).press("Tab");
  const intro = page.locator("#battle-intro");
  await expect(intro).toHaveAttribute("aria-label", /<b>Teo & Co<\/b>/);
  await expect(intro.locator("b")).toHaveCount(0);
  await page
    .getByLabel("Battle mode", { exact: true })
    .selectOption("training");
  await page.getByLabel("Opening frame", { exact: true }).selectOption("20");
  await expect(intro).toHaveAttribute("data-clip", "pvp_battle_start_training");
  await expect(intro).toHaveAttribute("aria-label", /Goblin Stadium/);
  await expect(intro).not.toHaveAttribute("aria-label", /Arena 1/);
  await page.getByLabel("Opening frame", { exact: true }).selectOption("103");
  await expect(page.locator("#status")).toContainText("battle 0.00s · ready");
  await page.getByRole("button", { name: "Step 1 frame", exact: true }).click();
  await expect(page.locator("#status")).toContainText("battle 0.03s · ready");
});
test("native intro holds combat and elixir, pauses in the background, then enables deployment", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await ready(page);
  await page.locator("#battle-button").click();
  await expect(page.locator("#hand .game-card").first()).toBeDisabled();
  await expect(page.locator("#match-clock")).toHaveText("3:00");
  await expect
    .poll(() => page.evaluate(() => (window as any).__arena.state.intro.frame))
    .toBeGreaterThanOrEqual(30);
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  const held = await page.evaluate(() => (window as any).__arena.state);
  expect(held.time).toBe(0);
  expect(held.actions).toBe(0);
  expect(held.intro.blocking).toBe(true);
  await expect(page.locator("#elixir-number")).toHaveText("5");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(350);
  const hidden = await page.evaluate(() => (window as any).__arena.state);
  expect(hidden.intro).toEqual(held.intro);
  expect(hidden.time).toBe(0);
  await page.evaluate(() => {
    delete (document as any).hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page
    .getByRole("button", { name: "Resume battle", exact: true })
    .click();
  await expect(page.locator("#hand .game-card").first()).toBeEnabled({
    timeout: 10000,
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).__arena.state.time))
    .toBeGreaterThan(0);
  await expect(page.locator("#battle-intro")).toBeHidden({ timeout: 10000 });
  expect(errors).toEqual([]);
});

test("replay intro fits long names on phones and seeking cancels the opening", async ({
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
          name: "WWWWWWWWWWWWWWWWWW",
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
  await ready(page);
  await page.getByRole("button", { name: "Battle log", exact: true }).click();
  await page.locator('[data-replay="0"]').click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__arena.state.intro.frame))
    .toBeGreaterThanOrEqual(68);
  await page.getByRole("button", { name: "Pause replay", exact: true }).click();
  const opening = page.locator("#battle-intro");
  await expect(opening).toHaveAttribute("aria-label", /WWWWWWWWWWWWWWWWWW/);
  await expect(opening.locator('image[href*="shape-638"]')).toHaveCount(0);
  const held = await opening.innerHTML();
  await page.waitForTimeout(200);
  expect(await opening.innerHTML()).toBe(held);
  const sizes =
    info.project.name === "desktop"
      ? [{ width: 1440, height: 900 }]
      : [
          { width: 320, height: 568 },
          { width: 390, height: 844 },
          { width: 667, height: 375 },
          { width: 844, height: 390 },
        ];
  for (const size of sizes) {
    await page.setViewportSize(size);
    const measurements = await opening.evaluate((host) => {
      const r = host.getBoundingClientRect();
      const texts = [...host.querySelectorAll("text")]
        .filter((e) => getComputedStyle(e.parentElement!).opacity !== "0")
        .map((e) => {
          const b = e.getBoundingClientRect();
          return { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
        });
      return {
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        texts,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    expect(measurements.overflow).toBe(false);
    for (const box of measurements.texts) {
      expect(box.left).toBeGreaterThanOrEqual(measurements.left);
      expect(box.right).toBeLessThanOrEqual(measurements.right);
      expect(box.top).toBeGreaterThanOrEqual(measurements.top);
      expect(box.bottom).toBeLessThanOrEqual(measurements.bottom);
    }
    await page.screenshot({
      path: `test-results/${info.project.name}-native-intro-${size.width}.png`,
    });
  }
  await page.getByRole("slider", { name: "Replay timeline" }).fill("50");
  await expect(opening).toBeHidden();
  expect(
    await page.evaluate(() => (window as any).__arena.state.intro.active),
  ).toBe(false);
  await page.getByRole("slider", { name: "Replay timeline" }).fill("0");
  await expect(opening).toBeHidden();
  await page.getByRole("slider", { name: "Replay timeline" }).fill("100");
  await page
    .getByRole("button", { name: "Restart replay", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__arena.state.intro.blocking),
    )
    .toBe(true);
});
