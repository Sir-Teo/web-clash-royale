import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
const replay = JSON.parse(
  readFileSync("tests/fixtures/combat-v4-replay.json", "utf8"),
).replay;

test("native timer transitions and independent crown awards freeze and reset correctly", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/tests/fixtures/hud.html");
  await expect(page.locator("#status")).toContainText("6 HUD clips", {
    timeout: 30000,
  });
  const timer = page.locator(".native-timer-art"),
    score = page.locator(".native-score-art");
  await expect(timer.locator("text")).toHaveText(["3:00", "Time left:"]);
  await page.locator("#blue").fill("2");
  await expect(score).toHaveAttribute("data-blue-frame", "0");
  await expect(score).toHaveAttribute("data-red-frame", "99");
  await expect(score.locator("text")).toHaveText(["0", "2"]);
  await page.locator("#step").click();
  await expect(score).toHaveAttribute("data-blue-frame", "3");
  const held = await score.innerHTML();
  await page.waitForTimeout(200);
  expect(await score.innerHTML()).toBe(held);
  for (const [time, name, frame, text] of [
    ["180.2", "HUD_topRight", "6", "0:00"],
    ["180.7", "HUD_topRight_overtime", "6", "2:00"],
    ["181", "HUD_topRight_overtime", "14", "1:59"],
    ["300", "HUD_topRight_overtime", "14", "0:00"],
    ["30", "HUD_topRight", "0", "2:30"],
  ]) {
    await page.locator("#time").fill(time);
    await expect(timer).toHaveAttribute("data-clip", name);
    await expect(timer).toHaveAttribute("data-frame", frame);
    await expect(timer.locator("text").first()).toHaveText(text);
    await expect(score).toHaveAttribute("data-blue-frame", "99");
  }
  await page.locator("#time").fill("181");
  await page.locator("#red").fill("1");
  await expect(score).toHaveAttribute("data-red-frame", "0");
  await page.locator("#reset").click();
  await expect(score).toHaveAttribute("data-red-frame", "99");
  await page.screenshot({
    path: `test-results/${info.project.name}-native-hud-fixture.png`,
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator("#time").fill("180");
  await expect(timer).toHaveAttribute("data-clip", "HUD_topRight_overtime");
  await expect(timer).toHaveAttribute("data-frame", "14");
  await page.locator("#blue").fill("3");
  await expect(score).toHaveAttribute("data-blue-frame", "99");
  expect(errors).toEqual([]);
});

test("replay timer, elixir badge and crown counters fit six phone sizes without paused writes", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(
    (replay) =>
      localStorage.setItem(
        "browser-royale.profile.v1",
        JSON.stringify({
          version: 1,
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
    .poll(() => page.evaluate(() => (window as any).__arena?.state.loadedHud), {
      timeout: 30000,
    })
    .toBe(6);
  await page.getByRole("button", { name: "Battle log", exact: true }).click();
  await page.locator('[data-replay="0"]').click();
  await page.getByRole("button", { name: "Pause replay", exact: true }).click();
  const seek = page.getByRole("slider", { name: "Replay timeline" }),
    timer = page.locator(".native-timer-art");
  await seek.fill("60.1");
  await expect(timer).toHaveAttribute("data-clip", "HUD_topRight");
  await expect(timer).toHaveAttribute("data-frame", "9");
  await seek.fill("60.2");
  await expect(timer).toHaveAttribute("data-clip", "HUD_topRight_overtime");
  await expect(timer).toHaveAttribute("data-frame", "3");
  await seek.fill("83");
  await expect(timer).toHaveAttribute("data-frame", "14");
  await expect(timer.locator("text")).toHaveText(["0:51", "Overtime"]);
  await expect(page.locator("#elixir-rate text")).toHaveText("x3");
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
    const landscape = size.width > size.height && size.height < 540;
    await expect(page.locator(".native-score-art > svg")).toHaveAttribute(
      "viewBox",
      landscape ? "-215 -107 80 210" : "-69 -132 80 266",
    );
    await expect
      .poll(() =>
        page.evaluate(() => {
          const a = document
            .querySelector("#arena-canvas")!
            .getBoundingClientRect();
          return [
            ...document.querySelectorAll(
              ".native-timer-ready,.native-score-ready,#elixir-rate",
            ),
          ].every((e) => {
            const r = e.getBoundingClientRect();
            return (
              r.left >= a.left - 1 &&
              r.right <= a.right + 1 &&
              r.top >= a.top - 1 &&
              r.bottom <= a.bottom + 1
            );
          });
        }),
      )
      .toBe(true);
    const scores = await page
      .locator(".native-score-art text")
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    for (const h of scores) expect(h).toBeGreaterThan(15);
    const digits = await timer.locator("text").first().boundingBox();
    expect(digits!.height).toBeGreaterThan(20);
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
        path: `test-results/${info.project.name}-native-hud-${size.width}.png`,
      });
  }
  await expect
    .poll(() =>
      page.locator(".match-top").evaluate(
        (e) =>
          new Promise<number>((resolve) => {
            let count = 0;
            const o = new MutationObserver((r) => (count += r.length));
            o.observe(e, {
              subtree: true,
              attributes: true,
              childList: true,
              characterData: true,
            });
            setTimeout(() => {
              o.disconnect();
              resolve(count);
            }, 200);
          }),
      ),
    )
    .toBe(0);
  await seek.fill("10");
  await expect(timer).toHaveAttribute("data-clip", "HUD_topRight");
  await expect(timer).toHaveAttribute("data-frame", "0");
  await expect(timer.locator("text").first()).toHaveText("2:30");
  await expect(page.locator(".native-score-art")).toHaveAttribute(
    "data-red-frame",
    "99",
  );
  expect(errors).toEqual([]);
});

test("live replay crown flights reach native counter artwork and seeking clears award feedback", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(
    (replay) =>
      localStorage.setItem(
        "browser-royale.profile.v1",
        JSON.stringify({
          version: 1,
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
    .poll(() => page.evaluate(() => (window as any).__arena?.state.loadedHud), {
      timeout: 30000,
    })
    .toBe(6);
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const s = (window as any).__arena.state;
          return (
            s.loadedEffects === 45 &&
            s.loadedAnimations === 19 &&
            s.loadedBuildings === 3 &&
            s.loadedHealth === 22
          );
        }),
      { timeout: 30000 },
    )
    .toBe(true);
  await page.getByRole("button", { name: "Battle log", exact: true }).click();
  await page.locator('[data-replay="0"]').click();
  await page.getByRole("button", { name: "Pause replay", exact: true }).click();
  const seek = page.getByRole("slider", { name: "Replay timeline" });
  await seek.fill("98");
  await expect(page.locator(".native-score-art")).toHaveAttribute(
    "data-red-frame",
    "99",
  );
  await page.locator("#replay-speed").click();
  await page.locator("#replay-speed").click();
  await page
    .getByRole("button", { name: "Resume replay", exact: true })
    .click();
  await expect(page.locator("#red-crowns")).toHaveText("3");
  await expect
    .poll(() => page.evaluate(() => (window as any).__arena.state.hud.redFrame))
    .toBeLessThan(99);
  let nearest = Infinity;
  await expect
    .poll(
      async () => {
        const distance = await page.evaluate(() => {
          const a = document
              .querySelector("#arena-canvas")!
              .getBoundingClientRect(),
            r = document
              .querySelector('.native-score-art [data-binding="starEnemy"]')!
              .getBoundingClientRect(),
            p = {
              x: r.left + r.width / 2 - a.left,
              y: r.top + r.height / 2 - a.top,
            };
          return Math.min(
            Infinity,
            ...(window as any).__arena.state.crownFlights
              .filter((f: any) => f.team === "red" && f.visible)
              .map((f: any) => Math.hypot(f.x - p.x, f.y - p.y)),
          );
        });
        nearest = Math.min(nearest, distance);
        return nearest;
      },
      { timeout: 5000, intervals: [25, 25, 50] },
    )
    .toBeLessThan(15);
  await seek.fill("100");
  await expect(page.locator(".native-score-art")).toHaveAttribute(
    "data-red-frame",
    "99",
  );
  await expect(page.locator("#red-crowns")).toHaveText("3");
  await seek.fill("0");
  await expect(page.locator("#red-crowns")).toHaveText("0");
  await expect(page.locator(".native-score-art")).toHaveAttribute(
    "data-red-frame",
    "99",
  );
  expect(errors).toEqual([]);
});

test("unavailable native HUD retains the timer and crown fallback", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/assets/ui/hud/hud.json", (r) => r.abort());
  await page.goto("/");
  await page.locator("#battle-button").click();
  await expect(page.locator("#hand .game-card").first()).toBeEnabled({
    timeout: 15000,
  });
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  await expect(page.locator(".native-timer-ready")).toHaveCount(0);
  await expect(page.locator("#match-clock")).toBeVisible();
  await expect(page.locator("#red-crowns")).toBeVisible();
  await expect(page.locator("#blue-crowns")).toHaveText("0");
  expect(errors).toEqual([]);
});
