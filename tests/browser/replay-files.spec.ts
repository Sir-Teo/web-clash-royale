import { test, expect } from "@playwright/test";
import { readFile, readFileSync } from "node:fs";
import { promisify } from "node:util";
const read = promisify(readFile);
const replay = JSON.parse(
  readFileSync("tests/fixtures/combat-v4-replay.json", "utf8"),
).replay;
const key = "browser-royale.profile.v1";
const envelope = (red = false) => ({
  format: "browser-royale-replay",
  version: 1,
  playerName: "Sender King",
  match: {
    date: "2026-10-24T12:00:00.000Z",
    mode: replay.mode,
    winner: red ? "blue" : "red",
    crowns: red ? [3, 0] : [0, 3],
    opponent: "Other King",
    opponentType: "friend",
    replay: {
      ...structuredClone(replay),
      version: 5,
      ...(red ? { perspective: "red" } : {}),
    },
  },
});
const file = (data: unknown) => ({
  name: "shared-replay.json",
  mimeType: "application/json",
  buffer: Buffer.from(JSON.stringify(data)),
});
const saved = (page: any) =>
  page.evaluate((key: string) => localStorage.getItem(key), key);
async function open(page: any) {
  await page.getByRole("button", { name: "Battle log", exact: true }).click();
  await expect(page.locator("#open-replay-file")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ key, replay }) => {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          name: "Receiver King",
          gold: 777,
          trophies: 123,
          battles: 1,
          sound: false,
          seenTutorial: true,
          history: [
            {
              id: 42,
              date: "2026-10-24T12:00:00.000Z",
              mode: replay.mode,
              winner: "red",
              crowns: [0, 3],
              opponent: "Royal Trainer",
              matchId: "private-room-id",
              replay: { ...replay, version: 5 },
            },
          ],
        }),
      );
    },
    { key, replay },
  );
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).__arena);
});

test("exports one recording and watches its import without changing local progress", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page);
  await page.locator("[data-match-details]").click();
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export replay", exact: true })
    .click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(
    /^browser-arena-replay-2026-10-24\.json$/,
  );
  const text = await read((await download.path())!, "utf8"),
    data = JSON.parse(text);
  expect(data.playerName).toBe("Receiver King");
  expect(data.match.replay.version).toBe(5);
  expect(data).not.toHaveProperty("profile");
  expect(data.match).not.toHaveProperty("matchId");
  await page
    .getByRole("button", { name: "Back to battle log", exact: true })
    .click();
  const before = await saved(page);
  await page.locator("#replay-file").setInputFiles({
    name: "my-replay.json",
    mimeType: "application/json",
    buffer: Buffer.from(text),
  });
  await expect(
    page.getByRole("heading", { name: "Shared replay", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".shared-replay .match-deck-grid .game-card"),
  ).toHaveCount(16);
  await page.locator("[data-shared-card]").first().click();
  await page
    .getByRole("button", { name: "Back to shared replay", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Shared replay", exact: true }),
  ).toBeVisible();
  expect(await saved(page)).toBe(before);
  await expect
    .poll(() =>
      page
        .locator(".modal-backdrop")
        .evaluate((e) => getComputedStyle(e).opacity),
    )
    .toBe("1");
  await page.evaluate(async () => {
    const files = new Set(
      [
        ...document.querySelectorAll<SVGImageElement>(".shared-replay image"),
      ].map((image) => image.href.baseVal),
    );
    await Promise.all(
      [...files].map((src) => {
        const image = new Image();
        image.src = src;
        return image.decode();
      }),
    );
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  await page.screenshot({
    path: info.outputPath("shared-replay-preview.png"),
    fullPage: false,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Watch shared replay", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath("shared-replay-footer.png"),
    fullPage: false,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Watch shared replay", exact: true })
    .click();
  await expect(page.locator(".match-bottom .player-name")).toHaveText(
    "Receiver King",
  );
  const seek = page.getByRole("slider", { name: "Replay timeline" });
  await seek.focus();
  await seek.press("End");
  await expect
    .poll(() => page.evaluate(() => (window as any).__arena.state.winner))
    .toBe("red");
  await page.locator("#replay-exit").click();
  expect(await saved(page)).toBe(before);
  expect(errors).toEqual([]);
});

test("keeps the shared red-side identity through ending, rewind and restart, then restores the local name", async ({
  page,
}) => {
  const before = await saved(page);
  await open(page);
  await page.locator("#replay-file").setInputFiles(file(envelope(true)));
  await expect(page.locator(".shared-replay-names")).toContainText(
    "Sender King",
  );
  const ids = await page
    .locator(".shared-replay .match-deck-panel")
    .first()
    .locator("[data-native-card]")
    .evaluateAll((els: any[]) => els.map((e) => e.dataset.nativeCard));
  expect(ids).toEqual(replay.enemyDeck);
  await page
    .getByRole("button", { name: "Watch shared replay", exact: true })
    .click();
  await expect(page.locator(".match-bottom .player-name")).toHaveText(
    "Sender King",
  );
  await expect(page.locator(".competitor.enemy b")).toHaveText("Other King");
  const seek = page.getByRole("slider", { name: "Replay timeline" });
  await seek.focus();
  await seek.press("End");
  await expect
    .poll(() => page.evaluate(() => (window as any).__arena.state.winner))
    .toBe("blue");
  await expect(
    page.getByRole("img", { name: /Match over\. Sender King:/ }),
  ).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByRole("button", { name: "Restart replay", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Restart replay", exact: true })
    .click();
  await expect(page.locator(".match-bottom .player-name")).toHaveText(
    "Sender King",
  );
  await seek.focus();
  await seek.press("End");
  await seek.press("Home");
  await expect(page.locator(".match-bottom .player-name")).toHaveText(
    "Sender King",
  );
  await page.locator("#replay-exit").click();
  await expect(page.locator(".player-card .player-name")).toHaveText(
    "Receiver King",
  );
  expect(await saved(page)).toBe(before);
});

test("rejects invalid files in place, permits reselection, escapes names and contains keyboard focus on phones", async ({
  page,
}, info) => {
  const before = await saved(page);
  await open(page);
  const bad = envelope();
  bad.match.replay.deck[0] = "toString";
  await page.locator("#replay-file").setInputFiles(file(bad));
  await expect(page.getByRole("alert")).toContainText("invalid");
  expect(await saved(page)).toBe(before);
  const data = envelope();
  data.playerName = "<b>Sender</b>";
  data.match.opponent = '<img src=x onerror="bad()">';
  await page.locator("#replay-file").setInputFiles(file(data));
  await expect(
    page.getByRole("heading", { name: "Shared replay", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".shared-replay-names")).toContainText(
    "<b>Sender</b>",
  );
  await expect(page.locator(".shared-replay-names img")).toHaveCount(0);
  const close = page.getByRole("button", { name: "Close dialog", exact: true }),
    watch = page.getByRole("button", {
      name: "Watch shared replay",
      exact: true,
    });
  await close.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(watch).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  if (info.project.name !== "desktop")
    await page.setViewportSize({ width: 320, height: 740 });
  await watch.scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await watch.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  if (info.project.name !== "desktop") {
    await page.setViewportSize({ width: 844, height: 390 });
    await watch.scrollIntoViewIfNeeded();
    await page.evaluate(
      () =>
        new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r())),
        ),
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await watch.evaluate((e) => {
        const b = e.getBoundingClientRect(),
          d = e.closest(".modal")!.getBoundingClientRect();
        return Math.min(b.bottom, d.bottom) - Math.max(b.top, d.top);
      }),
    ).toBeGreaterThanOrEqual(44);
  }
  await page
    .getByRole("button", { name: "Back to battle log", exact: true })
    .click();
  expect(await saved(page)).toBe(before);
});
