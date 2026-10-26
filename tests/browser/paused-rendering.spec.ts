import { test, expect, type Page } from "@playwright/test";
import { expectedAnimations, expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
test.setTimeout(120000);
const key = "browser-royale.profile.v1";
const deck = [
  "prince",
  "knight",
  "archers",
  "giant",
  "musketeer",
  "arrows",
  "zap",
  "fireball",
];
const replay = {
  rulesFamily: "origin",
  version: 17,
  seed: 1,
  mode: "classic",
  deck,
  enemyDeck: deck,
  duration: 900,
  actions: [{ tick: 0, team: "blue", card: "prince", x: 14, y: 23 }],
};
const state = (page: Page) =>
  page.evaluate(() => (window as any).__arena.state);
const game = (value: any) => ({
  time: value.time,
  elixir: value.elixir,
  hand: value.hand,
  units: value.units,
  actions: value.actions,
});
async function boot(
  page: Page,
  viewer = "blue",
  knight = false,
  emptyMirror = false,
) {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(
    ({ key, replay, viewer, knight, emptyMirror }) => {
      if (knight) {
        replay.deck = ["knight", "prince", ...replay.deck.slice(2)];
        replay.actions[0].card = "knight";
      }
      if (emptyMirror) {
        replay.deck = ["mirror", ...replay.deck.slice(1)];
        replay.actions = [];
      }
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          seenTutorial: true,
          sound: false,
          music: false,
          history: [
            {
              id: 1,
              date: "2026-10-25T00:00:00Z",
              mode: "classic",
              winner: "blue",
              crowns: [1, 0],
              replay: { ...replay, perspective: viewer },
            },
          ],
        }),
      );
    },
    { key, replay, viewer, knight, emptyMirror },
  );
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).__arena);
}
async function openReplay(page: Page) {
  await page.getByRole("button", { name: "Battle log", exact: true }).click();
  await page.locator('[data-replay="0"]').click();
  await page.getByRole("button", { name: "Pause replay", exact: true }).click();
  await page.getByRole("slider", { name: "Replay timeline" }).fill("10");
}
async function quiet(page: Page) {
  await expect
    .poll(
      async () => {
        const s = await state(page);
        return s.paused && !s.renderPending;
      },
      { timeout: 60000 },
    )
    .toBe(true);
  const before = await state(page);
  await page.waitForTimeout(350);
  const after = await state(page);
  expect(after.renderedFrames).toBe(before.renderedFrames);
  expect(after.destruction.time).toBe(before.destruction.time);
  expect(game(after)).toEqual(game(before));
  return after;
}

async function nativeUIReady(page: Page) {
  await page.waitForFunction((cards) => {
    const s = (window as any).__arena.state;
    return (
      s.loadedCards === cards &&
      s.loadedHud === 6 &&
      s.loadedElixir === 8 &&
      s.loadedIntros === 2 &&
      s.loadedAnnouncements === 5
    );
  }, expectedCards);
}

async function assertQuietDom(page: Page) {
  await page.evaluate(() => {
    const result = { total: 0, targets: [] as string[] };
    const collect = (records: MutationRecord[]) => {
      result.total += records.length;
      for (const r of records)
        if (result.targets.length < 8) {
          const e = r.target as Element;
          result.targets.push(
            `${e.id || e.nodeName}:${r.attributeName || r.type}`,
          );
        }
    };
    const observer = new MutationObserver(collect);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
    });
    (window as any).__pausedDom = { observer, result, collect };
  });
  await page.waitForTimeout(700);
  const mutations = await page.evaluate(() => {
    const p = (window as any).__pausedDom;
    p.collect(p.observer.takeRecords());
    p.observer.disconnect();
    return p.result;
  });
  expect(mutations).toEqual({ total: 0, targets: [] });
}

for (const viewer of ["blue", "red"])
  test(`${viewer} paused replay sleeps, retains pixels and redraws for real presentation changes`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await boot(page, viewer);
    await expect
      .poll(async () => (await state(page)).loadedAnimations, {
        timeout: 60000,
      })
      .toBe(expectedAnimations);
    await nativeUIReady(page);
    await openReplay(page);
    const held = await quiet(page);
    expect(held.time).toBe(3);
    expect(held.frameLoopRunning).toBe(true);
    const saved = await page.evaluate((key) => localStorage.getItem(key), key);
    const canvas = page.locator("#arena-canvas canvas");
    const before = await canvas.screenshot();
    await assertQuietDom(page);
    expect((await canvas.screenshot()).equals(before)).toBe(true);
    expect((await state(page)).renderedFrames).toBe(held.renderedFrames);

    // A resumed page must explicitly repaint its saved canvas, even while paused.
    await page.evaluate(() => {
      window.dispatchEvent(new Event("pagehide"));
      window.dispatchEvent(new Event("pageshow"));
    });
    await expect
      .poll(async () => (await state(page)).renderedFrames)
      .toBeGreaterThan(held.renderedFrames);
    const shown = await quiet(page);
    expect(game(shown)).toEqual(game(held));
    expect((await canvas.screenshot()).equals(before)).toBe(true);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect
      .poll(async () => (await state(page)).renderedFrames)
      .toBeGreaterThan(shown.renderedFrames);
    const reduced = await quiet(page);
    expect(game(reduced)).toEqual(game(held));

    const initialBox = await canvas.boundingBox();
    await page.setViewportSize(
      info.project.name === "desktop"
        ? { width: 780, height: 640 }
        : { width: 320, height: 568 },
    );
    await expect
      .poll(async () => (await state(page)).renderedFrames)
      .toBeGreaterThan(reduced.renderedFrames);
    const resized = await quiet(page);
    expect(await canvas.boundingBox()).not.toEqual(initialBox);
    expect(game(resized)).toEqual(game(held));

    const resizedPixels = await canvas.screenshot();
    await page.getByRole("slider", { name: "Replay timeline" }).fill("35");
    await expect
      .poll(async () => (await state(page)).renderedFrames)
      .toBeGreaterThan(resized.renderedFrames);
    const sought = await quiet(page);
    expect(sought.time).toBe(10.5);
    await expect(page.locator("#replay-clock")).toHaveText("0:10 / 0:30");
    await expect(
      page.getByRole("slider", { name: "Replay timeline" }),
    ).toHaveAttribute("aria-valuetext", "0:10 of 0:30");
    expect(sought.units).not.toEqual(held.units);
    expect((await canvas.screenshot()).equals(resizedPixels)).toBe(false);
    await page.screenshot({
      path: info.outputPath(`paused-${viewer}-repaint.png`),
    });
    await page.waitForTimeout(700);
    const pausedEffects = (await state(page)).destruction.time;
    await page
      .getByRole("button", { name: "Resume replay", exact: true })
      .click();
    await expect
      .poll(async () => (await state(page)).time)
      .toBeGreaterThan(sought.time);
    const playing = await state(page);
    expect(playing.destruction.time - pausedEffects).toBeLessThan(
      playing.time - sought.time + 0.3,
    );
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

test("an unavailable Mirror remains disabled without repeated DOM writes", async ({
  page,
}) => {
  await boot(page, "blue", false, true);
  await nativeUIReady(page);
  await openReplay(page);
  const held = await quiet(page);
  const mirror = page.locator('#hand [data-native-card="mirror"]');
  await expect(mirror).toBeDisabled();
  await expect(mirror).toHaveAttribute("data-card-cost", "?");
  await assertQuietDom(page);
  expect(game(await state(page))).toEqual(game(held));
});

test("late native artwork replaces a fallback while the replay is paused, then rendering sleeps", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/assets/animations/knight.json", async (route) => {
    await gate;
    await route.continue();
  });
  try {
    await boot(page, "blue", true);
    await openReplay(page);
    await expect
      .poll(async () =>
        (await state(page)).units.some((e: any) => e.card === "knight"),
      )
      .toBe(true);
    expect((await state(page)).renderPending).toBe(true);
    const held = await state(page);
    await page.waitForTimeout(350);
    expect((await state(page)).renderedFrames).toBeGreaterThan(
      held.renderedFrames,
    );
    const fallback = await page.locator("#arena-canvas canvas").screenshot();
    release();
    const ready = await quiet(page);
    expect(ready.loadedAnimations).toBe(expectedAnimations);
    expect(game(ready)).toEqual(game(held));
    expect(
      (await page.locator("#arena-canvas canvas").screenshot()).equals(
        fallback,
      ),
    ).toBe(false);
  } finally {
    release();
  }
});

test("solo pause removes deployment artwork, sleeps and resumes without catching up presentation time", async ({
  page,
}) => {
  await boot(page);
  await expect
    .poll(async () => (await state(page)).loadedAnimations, { timeout: 60000 })
    .toBe(expectedAnimations);
  await page.locator("#battle-button").click();
  await expect
    .poll(async () => (await state(page)).intro.blocking, { timeout: 30000 })
    .toBe(false);
  await page.locator("#arena-canvas canvas").focus();
  await page.keyboard.press("1");
  await expect.poll(async () => (await state(page)).placement).not.toBeNull();
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("dialog", { name: "Battle paused", exact: true }),
  ).toBeVisible();
  const held = await quiet(page);
  expect(held.placement).toBeNull();
  await page.waitForTimeout(700);
  expect((await state(page)).renderedFrames).toBe(held.renderedFrames);
  await page
    .getByRole("button", { name: "Resume battle", exact: true })
    .click();
  await expect
    .poll(async () => (await state(page)).time)
    .toBeGreaterThan(held.time);
  const playing = await state(page);
  expect(playing.destruction.time - held.destruction.time).toBeLessThan(
    playing.time - held.time + 0.3,
  );
});
