import { test, expect, type Page } from "@playwright/test";
import { readFile, readFileSync } from "node:fs";
import { promisify } from "node:util";
const read = promisify(readFile),
  key = "browser-royale.profile.v1";
const replay = JSON.parse(
  readFileSync("tests/fixtures/combat-v4-replay.json", "utf8"),
).replay;
const state = (page: Page) =>
  page.evaluate(() => (window as any).__arena?.state);
const saved = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
async function init(page: Page, history: unknown[] = []) {
  await page.addInitScript(
    ({ key, history }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            name: "Battle King",
            gold: 777,
            trophies: 123,
            battles: 0,
            sound: false,
            music: false,
            seenTutorial: true,
            history,
          }),
        );
    },
    { key, history },
  );
  await page.goto("/");
  await expect
    .poll(
      async () => {
        const s = await state(page);
        return s ? [s.loadedIntros, s.loadedEndings, s.loadedAnimations] : [];
      },
      { timeout: 60000 },
    )
    .toEqual([2, 5, 19]);
}
async function rename(page: Page, name: string) {
  await page.locator("#arena-settings").click();
  await page.locator("#player-name").fill(name);
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
}
async function details(page: Page) {
  await page.getByRole("button", { name: "Battle log", exact: true }).click();
  await page.locator("[data-match-details]").first().click();
}
async function download(page: Page) {
  const downloading = page.waitForEvent("download");
  await page.locator("#export-replay-file").click();
  const file = await downloading;
  return read((await file.path())!, "utf8");
}
async function endingName(page: Page, name: string) {
  await page.locator("#replay-seek").fill("100");
  await expect(
    page.locator("#battle-ending .native-ending-art"),
  ).toHaveAttribute(
    "aria-label",
    new RegExp(
      `^Match over\\. ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:`,
    ),
  );
}
test("a live battle keeps its starting name through profile edits, recording, replay and export", async ({
  page,
}, info) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await init(page);
  await page.locator("#battle-button").click();
  await expect(page.locator("#battle-intro")).toHaveAttribute(
    "aria-label",
    /Battle King/,
  );
  await expect
    .poll(async () => (await state(page)).intro.blocking, { timeout: 15000 })
    .toBe(false);
  await rename(page, "Future King");
  await expect(page.locator(".match-bottom .player-name")).toHaveText(
    "Battle King",
  );
  expect((await saved(page)).name).toBe("Future King");
  await page.locator("#pause-button").click();
  await page.locator("#surrender-button").click();
  await expect.poll(async () => (await saved(page)).history.length).toBe(1);
  expect((await saved(page)).history[0].playerName).toBe("Battle King");
  await expect(page.locator("#watch-replay")).toBeVisible({ timeout: 30000 });
  await page.locator("#watch-replay").click();
  await expect(page.locator(".match-bottom .player-name")).toHaveText(
    "Battle King",
  );
  await page.locator("#replay-play").click();
  await rename(page, "Newest King");
  await expect(page.locator(".match-bottom .player-name")).toHaveText(
    "Battle King",
  );
  await endingName(page, "Battle King");
  await page.locator("#replay-play").click();
  await expect(page.locator("#battle-intro")).toHaveAttribute(
    "aria-label",
    /Battle King/,
  );
  await page.locator("#replay-exit").click();
  await expect(page.locator(".player-card .player-name")).toHaveText(
    "Newest King",
  );
  await details(page);
  await expect(
    page.locator('[data-match-side="yours"] .match-deck-heading p'),
  ).toHaveText("Battle King");
  const text = await download(page),
    payload = JSON.parse(text);
  expect(payload.playerName).toBe("Battle King");
  expect(payload.version).toBe(1);
  expect(payload.match).not.toHaveProperty("playerName");
  await page
    .getByRole("button", { name: "Back to battle log", exact: true })
    .click();
  const before = await saved(page);
  await page.locator("#replay-file").setInputFiles({
    name: "captured-name.json",
    mimeType: "application/json",
    buffer: Buffer.from(text),
  });
  await expect(page.locator(".shared-replay-names")).toContainText(
    "Battle King",
  );
  await page
    .getByRole("button", { name: "Watch shared replay", exact: true })
    .click();
  await expect(page.locator(".match-bottom .player-name")).toHaveText(
    "Battle King",
  );
  await endingName(page, "Battle King");
  await page.locator("#replay-exit").click();
  expect(await saved(page)).toEqual(before);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: info.outputPath("recorded-identity-lobby.png"),
  });
});
for (const viewer of ["blue", "red"] as const)
  test(`${viewer} saved identity survives reload, settings, seeking and export as plain text`, async ({
    page,
  }, info) => {
    const playerName = viewer === "blue" ? "<b>Old King</b>" : "Red Original";
    const history = [
      {
        id: 42,
        playerName,
        date: "2026-10-24T12:00:00.000Z",
        mode: replay.mode,
        winner: viewer === "red" ? "blue" : "red",
        crowns: viewer === "red" ? [3, 0] : [0, 3],
        opponent: "Other King",
        opponentType: "friend",
        replay: { ...replay, version: 5, perspective: viewer },
      },
    ];
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await init(page, history);
    await rename(page, "Current King");
    await page.reload();
    await page.waitForFunction(
      () => (window as any).__arena?.state.loadedEndings === 5,
    );
    await details(page);
    const label = page.locator(
      '[data-match-side="yours"] .match-deck-heading p',
    );
    await expect(label).toHaveText(playerName);
    await expect(label.locator("b")).toHaveCount(0);
    const text = await download(page);
    expect(JSON.parse(text).playerName).toBe(playerName);
    await page.locator("#match-replay").click();
    await expect(page.locator(".match-bottom .player-name")).toHaveText(
      playerName,
    );
    await expect(page.locator("#battle-intro")).toHaveAttribute(
      "aria-label",
      new RegExp(viewer === "blue" ? "Old King" : "Red Original"),
    );
    await page.locator("#replay-play").click();
    await rename(page, "Latest King");
    await expect(page.locator(".match-bottom .player-name")).toHaveText(
      playerName,
    );
    await endingName(page, playerName);
    await page.locator("#replay-seek").fill("25");
    await expect(page.locator(".match-bottom .player-name")).toHaveText(
      playerName,
    );
    await page.locator("#replay-seek").fill("100");
    await page.locator("#replay-play").click();
    await expect(page.locator(".match-bottom .player-name")).toHaveText(
      playerName,
    );
    await page.locator("#replay-exit").click();
    await expect(page.locator(".player-card .player-name")).toHaveText(
      "Latest King",
    );
    expect((await saved(page)).history[0].playerName).toBe(playerName);
    expect((await saved(page)).battles).toBe(0);
    expect((await saved(page)).gold).toBe(777);
    expect(errors).toEqual([]);
    await details(page);
    await expect
      .poll(() =>
        page
          .locator(".modal-backdrop")
          .evaluate((e) => getComputedStyle(e).opacity),
      )
      .toBe("1");
    await page.screenshot({
      path: info.outputPath(`recorded-name-${viewer}.png`),
    });
  });
test("legacy recordings use the opening profile name without rewriting their history", async ({
  page,
}) => {
  await init(page, [
    {
      id: 42,
      date: "2026-10-24T12:00:00.000Z",
      mode: replay.mode,
      winner: "red",
      crowns: [0, 3],
      opponent: "Royal Trainer",
      replay: { ...replay, version: 5 },
    },
  ]);
  await details(page);
  await expect(
    page.locator('[data-match-side="yours"] .match-deck-heading p'),
  ).toHaveText("Your starting eight");
  await page.locator("#match-replay").click();
  await page.locator("#replay-play").click();
  await rename(page, "Future King");
  await expect(page.locator(".match-bottom .player-name")).toHaveText(
    "Battle King",
  );
  await endingName(page, "Battle King");
  await page.locator("#replay-play").click();
  await expect(page.locator(".match-bottom .player-name")).toHaveText(
    "Battle King",
  );
  await page.locator("#replay-exit").click();
  await details(page);
  expect(JSON.parse(await download(page)).playerName).toBe("Future King");
  expect((await saved(page)).history[0]).not.toHaveProperty("playerName");
});
