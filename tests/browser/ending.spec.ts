import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const replay = JSON.parse(
  readFileSync("tests/fixtures/combat-v4-replay.json", "utf8"),
).replay;
const state = (page: Page) =>
  page.evaluate(() => (window as any).__arena?.state ?? {});
async function loadReplay(page: Page) {
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
              winner: "red",
              crowns: [0, 3],
              replay,
            },
          ],
        }),
      ),
    { ...replay, version: 5 },
  );
  await page.goto("/");
  await expect
    .poll(async () => (await state(page)).loadedEndings, { timeout: 30000 })
    .toBe(5);
  await page.getByRole("button", { name: "Battle log", exact: true }).click();
  await page.locator('[data-replay="0"]').click();
  await page.getByRole("button", { name: "Pause replay", exact: true }).click();
}

test("native ending keeps authored match text, crown states, long names and reduced-motion poses", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/tests/fixtures/ending.html");
  await expect(page.locator("#status")).toContainText("5 native ending clips", {
    timeout: 30000,
  });
  const end = page.locator("#ending");
  await page.locator("#time").fill("0.5");
  await expect(end).toHaveAttribute("data-stage", "match");
  await expect(end).toHaveAttribute("data-frame", "15");
  await expect(end.locator("text")).toHaveText("Match Over!");
  await page.screenshot({
    path: `test-results/${info.project.name}-native-match-over.png`,
    fullPage: true,
  });
  await page.locator("#time").fill("4.1");
  await expect(end).toHaveAttribute("data-stage", "scores");
  await expect(end.locator("text")).toHaveText(["Royal Trainer", "Sir Teo"]);
  await expect(end.locator('[data-binding^="blue/star"]')).toHaveCount(3);
  await expect(end.locator('[data-binding^="red/star"]')).toHaveCount(3);
  const crowns = await end
    .locator('[data-binding^="blue/star"]')
    .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
  expect(crowns[1]).toBeGreaterThan(crowns[0]);
  expect(crowns[2]).toBeCloseTo(crowns[1], 0);
  await page.screenshot({
    path: `test-results/${info.project.name}-native-ending-scores.png`,
    fullPage: true,
  });
  await page.locator("#player").fill("WWWWWWWWWWWWWWWWWW");
  await page.locator("#enemy").fill("<b>King & Q</b>");
  await expect(end.locator('[data-binding="enemyName/txt"] text')).toHaveText(
    "<b>King & Q</b>",
  );
  await expect(end.locator("b")).toHaveCount(0);
  await expect(
    end.locator('[data-binding="playerName/txt"] text'),
  ).toHaveAttribute("lengthAdjust", "spacingAndGlyphs");
  await page.locator("#hold").check();
  await expect(end).toHaveAttribute("data-frame", "87");
  const held = await end.innerHTML();
  await page.waitForTimeout(200);
  expect(await end.innerHTML()).toBe(held);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.locator("#hold").uncheck();
  await page.emulateMedia({ reducedMotion: "reduce" });
  // WebKit applies media emulation asynchronously; the next ending captures
  // this preference when it starts, so wait for that precondition first.
  await expect
    .poll(() =>
      page.evaluate(
        () => matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
    )
    .toBe(true);
  await page.locator("#time").fill("0.2");
  await expect(end).toHaveAttribute("data-stage", "scores");
  await expect(end).toHaveAttribute("data-frame", "87");
  await page.locator("#time").fill("1.4");
  await expect(end).toBeHidden();
  expect(errors).toEqual([]);
});

test("seeking a completed replay holds its final score, fits phones and clears on rewind", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await loadReplay(page);
  const seek = page.getByRole("slider", { name: "Replay timeline" });
  const end = page.locator("#battle-ending");
  await seek.fill("100");
  await expect(end).toHaveAttribute("data-stage", "scores");
  await expect(end).toHaveAttribute("data-frame", "87");
  expect((await state(page)).ending.result.crowns).toEqual({ blue: 0, red: 3 });
  await expect(
    end.getByRole("button", { name: "Continue", exact: true }),
  ).toBeHidden();
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
      .poll(() =>
        end.evaluate((host) => {
          const h = host.getBoundingClientRect();
          return [...host.querySelectorAll("text,[data-binding*=star]")].every(
            (e) => {
              const r = e.getBoundingClientRect();
              return (
                r.left >= h.left - 1 &&
                r.right <= h.right + 1 &&
                r.top >= h.top - 1 &&
                r.bottom <= h.bottom + 1
              );
            },
          );
        }),
      )
      .toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    for (const height of await end
      .locator("text")
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height)))
      expect(height).toBeGreaterThan(11);
    if (
      size.width === 390 ||
      size.width === 667 ||
      info.project.name === "desktop"
    )
      await page.screenshot({
        path: `test-results/${info.project.name}-native-ending-${size.width}.png`,
      });
  }
  const held = await end.innerHTML();
  await page.waitForTimeout(250);
  expect(await end.innerHTML()).toBe(held);
  await seek.fill("0");
  await expect(end).toBeHidden();
  expect((await state(page)).ending.active).toBe(false);
  await page.locator("#replay-exit").click();
  await expect(end).toBeHidden();
  expect(errors).toEqual([]);
});

test("playing through a King defeat runs ending once and freezes it in a background tab", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await loadReplay(page);
  const seek = page.getByRole("slider", { name: "Replay timeline" });
  await seek.fill("98");
  await page
    .getByRole("button", { name: "Resume replay", exact: true })
    .click();
  const end = page.locator("#battle-ending");
  await expect(end).toHaveAttribute("data-stage", "match", { timeout: 15000 });
  expect((await state(page)).ending.result.earned.red).toBeGreaterThan(0);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const before = (await state(page)).ending.time;
  await page.waitForTimeout(300);
  expect((await state(page)).ending.time).toBe(before);
  await page.evaluate(() => {
    delete (document as any).hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(end).toHaveAttribute("data-stage", "scores", { timeout: 15000 });
  await expect(end).toBeHidden({ timeout: 15000 });
  expect((await state(page)).winner).toBe("red");
  await page.waitForTimeout(200);
  await expect(end).toBeHidden();
  await page
    .getByRole("button", { name: "Restart replay", exact: true })
    .click();
  expect((await state(page)).winner).toBeNull();
  expect((await state(page)).ending.active).toBe(false);
  expect(errors).toEqual([]);
});

test("missing native ending assets still allow results, replay and another battle", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/assets/ui/ending/ending.json", (r) => r.abort());
  await page.goto("/");
  await page.locator("#battle-button").click();
  await expect(page.locator("#hand .game-card").first()).toBeEnabled({
    timeout: 15000,
  });
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  await page.getByRole("button", { name: "Leave battle", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Watch replay", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  expect((await state(page)).loadedEndings).toBe(0);
  await expect(page.locator("#battle-ending")).toBeHidden();
  await page.getByRole("button", { name: "Watch replay", exact: true }).click();
  await page.locator("#replay-exit").click();
  await page.locator("#battle-button").click();
  expect((await state(page)).winner).toBeNull();
  expect(errors).toEqual([]);
});

test("Continue skips the presentation after crown flights without duplicating the result", async ({
  page,
}) => {
  await page.goto("/");
  await expect
    .poll(async () => (await state(page)).loadedEndings, { timeout: 30000 })
    .toBe(5);
  await page.locator("#battle-button").click();
  await expect(page.locator("#hand .game-card").first()).toBeEnabled({
    timeout: 15000,
  });
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  await page.getByRole("button", { name: "Leave battle", exact: true }).click();
  const next = page
    .locator("#battle-ending")
    .getByRole("button", { name: "Continue", exact: true });
  await expect(next).toBeVisible({ timeout: 15000 });
  await next.click();
  await expect(
    page.getByRole("button", { name: "Watch replay", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#battle-ending")).toBeHidden();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  const records = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("browser-royale.profile.v1")!).history,
  );
  expect(records).toHaveLength(1);
  expect(records[0].winner).toBe("red");
});
