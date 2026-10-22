import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

async function expectUnclipped(page: Page) {
  const bounds = await page
    .locator("#battle-announcements")
    .evaluate((host) => {
      const outer = host.getBoundingClientRect();
      const parts = [...host.querySelectorAll("text, image")].map((part) => {
        const r = part.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      });
      return {
        outer: {
          left: outer.left,
          right: outer.right,
          top: outer.top,
          bottom: outer.bottom,
        },
        parts,
        width: innerWidth,
        height: innerHeight,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
  expect(bounds.overflow).toBe(false);
  expect(bounds.outer.left).toBeGreaterThanOrEqual(-1);
  expect(bounds.outer.right).toBeLessThanOrEqual(bounds.width + 1);
  expect(bounds.outer.top).toBeGreaterThanOrEqual(0);
  expect(bounds.outer.bottom).toBeLessThanOrEqual(bounds.height + 1);
  for (const part of bounds.parts) {
    expect(part.left).toBeGreaterThanOrEqual(bounds.outer.left - 1);
    expect(part.right).toBeLessThanOrEqual(bounds.outer.right + 1);
    expect(part.top).toBeGreaterThanOrEqual(bounds.outer.top - 1);
    expect(part.bottom).toBeLessThanOrEqual(bounds.outer.bottom + 1);
  }
}

test("native notices retain their typography, countdown, pause and voice timing", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/timing.html");
  await expect(page.locator("#status")).toContainText("5 native clips", {
    timeout: 30000,
  });
  expect(
    await page.evaluate(() => document.fonts.check('40px "Supercell Magic"')),
  ).toBe(true);
  const notice = page.locator("#battle-announcements");
  const moment = page.getByLabel("Moment", { exact: true });
  for (const [time, label] of [
    ["120.5", "60 Seconds Left"],
    ["123.2", "X2 Elixir"],
    ["150.5", "30 Seconds Left"],
    ["168.5", "Battle ends in..."],
    ["170.5", "10"],
    ["175.5", "5"],
    ["179.5", "1"],
    ["180.5", "Sudden Death - Get next crown to WIN -"],
    ["182.8", "+120s Extra Time"],
    ["243.2", "X3 Elixir"],
    ["295.5", "5"],
  ]) {
    await moment.selectOption(time);
    await expect(notice).toHaveAttribute("aria-label", label);
    await expect(notice).toBeVisible();
    await expectUnclipped(page);
    await expect(page.locator("#cue")).toHaveText("0 cues");
  }
  await moment.selectOption("175.5");
  await expect(notice).toHaveAttribute("aria-label", "5");
  await expect(notice).toBeVisible();
  const held = await notice.innerHTML();
  const heldFrame = Number(await notice.getAttribute("data-frame"));
  await page.waitForTimeout(300);
  expect(await notice.innerHTML()).toBe(held);
  await page.getByRole("button", { name: "Step 1 frame", exact: true }).click();
  // Some authored frames intentionally hold the same pose.
  await expect(notice).toHaveAttribute("data-frame", String(heldFrame + 1));
  await page.getByRole("button", { name: "1×", exact: true }).click();
  await page.getByRole("button", { name: "2×", exact: true }).click();
  await page.getByLabel("Sound", { exact: true }).check();
  const voice = page.waitForResponse((response) =>
    response.url().endsWith("/audio/4_cd_02.ogg"),
  );
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator("#cue")).toContainText("4_cd_02");
  expect((await voice).ok()).toBe(true);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const stoppedCues = await page.locator("#cue").textContent();
  await page.waitForTimeout(350);
  expect(await page.locator("#cue").textContent()).toBe(stoppedCues);
  await moment.selectOption("180");
  await expect(page.locator("#match-clock")).toHaveText("2:00");
  await page.getByRole("button", { name: "Finish here", exact: true }).click();
  await expect(notice).toBeHidden();
  await expect(page.locator("#match-clock")).toHaveText("0:00");
  await expect(page.locator("#phase-label")).toHaveText("TIME LEFT");
  await moment.selectOption("180.5");
  await expect(notice).toHaveAttribute("data-frame", "15");
  await page.screenshot({
    path: `test-results/${info.project.name}-native-overtime.png`,
  });
  expect(errors).toEqual([]);
});

test("real replay notices survive seeking, backgrounding and phone rotation", async ({
  page,
}, info) => {
  const fixture = JSON.parse(
    readFileSync("tests/fixtures/combat-v4-replay.json", "utf8"),
  );
  // An empty command history runs through regulation and overtime to a draw
  // without modifying the simulation through browser diagnostics.
  await page.addInitScript(
    (replay) => {
      localStorage.setItem(
        "browser-royale.profile.v1",
        JSON.stringify({
          version: 1,
          sound: false,
          seenTutorial: true,
          battles: 1,
          history: [
            {
              id: 1,
              date: "2026-10-22T12:00:00.000Z",
              mode: "classic",
              winner: "draw",
              crowns: [0, 0],
              replay,
            },
          ],
        }),
      );
    },
    { ...fixture.replay, version: 5, duration: 9000, actions: [] },
  );
  await page.goto("/");
  await expect
    .poll(
      () =>
        page.evaluate(() => (window as any).__arena.state.loadedAnnouncements),
      { timeout: 30000 },
    )
    .toBe(5);
  await page.getByRole("button", { name: "Battle log", exact: true }).click();
  await page.locator('[data-replay="0"]').click();
  await page.getByRole("button", { name: "Pause replay", exact: true }).click();
  const notice = page.locator("#battle-announcements");
  const seek = async (percent: number) => {
    await page
      .getByRole("slider", { name: "Replay timeline" })
      .fill(String(percent));
    await expect
      .poll(() => page.evaluate(() => (window as any).__arena.state.time))
      .toBe(percent * 3);
  };
  await seek(41);
  await expect(notice).toHaveAttribute("aria-label", "X2 Elixir");
  await seek(59);
  await expect(notice).toHaveAttribute("aria-label", "3");
  const held = await notice.innerHTML();
  await page.waitForTimeout(250);
  expect(await notice.innerHTML()).toBe(held);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const before = await page.evaluate(() => (window as any).__arena.state);
  await page.waitForTimeout(300);
  expect(await notice.innerHTML()).toBe(held);
  expect(
    await page.evaluate(() => (window as any).__arena.state.renderedFrames),
  ).toBe(before.renderedFrames);
  await page.evaluate(() => {
    delete (document as any).hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.getByRole("button", { name: "1×", exact: true }).click();
  await page.getByRole("button", { name: "2×", exact: true }).click();
  await page
    .getByRole("button", { name: "Resume replay", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__arena.state.time))
    .toBeGreaterThan(177.5);
  await page.getByRole("button", { name: "Pause replay", exact: true }).click();
  await seek(61);
  await expect(notice).toHaveAttribute("aria-label", "+120s Extra Time");
  await seek(81);
  await expect(notice).toHaveAttribute("aria-label", "X3 Elixir");
  await page.getByRole("button", { name: "4×", exact: true }).click();
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
    await expectUnclipped(page);
    await seek(59);
    await expect(notice).toHaveAttribute("aria-label", "3");
    // The authored first frame is compressed and faint; capture the full pop-in.
    await page
      .getByRole("button", { name: "Resume replay", exact: true })
      .click();
    await expect
      .poll(() => page.evaluate(() => (window as any).__arena.state.time))
      .toBeGreaterThan(177.25);
    await page
      .getByRole("button", { name: "Pause replay", exact: true })
      .click();
    await expect(notice.locator("g").first()).toHaveAttribute("opacity", "1");
    await expectUnclipped(page);
    await page.screenshot({
      path: `test-results/${info.project.name}-native-countdown-${size.width}.png`,
    });
    await seek(81);
  }
  await seek(100);
  await expect(notice).toBeHidden();
  expect(await page.evaluate(() => (window as any).__arena.state.winner)).toBe(
    "draw",
  );
  await expect(page.locator("#match-clock")).toHaveText("0:00");
});
