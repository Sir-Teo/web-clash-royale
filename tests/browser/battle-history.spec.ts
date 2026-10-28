import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { PRESETS } from "../../src/game/cards";

const fixture = JSON.parse(
  readFileSync("tests/fixtures/combat-v4-replay.json", "utf8"),
).replay;
const key = "browser-royale.profile.v1";
const idleReplay = (mode: string) => ({
  ...fixture,
  version: 56,
  rulesFamily: "origin",
  mode,
  deck: PRESETS[1].deck,
  enemyDeck: PRESETS[2].deck,
  duration: 30,
  actions: [],
});
const history = Array.from({ length: 10 }, (_, index) => ({
  id: 1, // IDs are not unique in old backups; row position is authoritative.
  date: `2026-10-${28 - index}T12:00:00.000Z`,
  winner: index === 1 ? "red" : index === 2 ? "blue" : "draw",
  crowns: index === 1 ? [0, 3] : index === 2 ? [3, 0] : [0, 0],
  mode: index === 0 ? "training" : index === 2 ? "double" : "classic",
  opponent:
    index === 0
      ? "Sparring Partner"
      : index === 1
        ? "<b>Élodie & King</b>"
        : index === 2
          ? "王小明"
          : index === 9
            ? undefined
            : `Royal Guard ${index}`,
  opponentType: [0, 2, 3, 5, 6, 8].includes(index)
    ? "ai"
    : index === 7
      ? "friend"
      : undefined,
  ...([0, 3, 6].includes(index) ? { practice: true } : {}),
  ...(index === 4 ? { matchId: "old-room" } : {}),
  replay:
    index === 1
      ? { ...fixture, version: 5 }
      : idleReplay(
          index === 0 ? "training" : index === 2 ? "double" : "classic",
        ),
}));
const profile = {
  version: 1,
  name: "Log Tester",
  battles: 42,
  wins: 12,
  crowns: 35,
  seenTutorial: true,
  sound: false,
  music: false,
  history,
};
const saved = (page: Page) =>
  page.evaluate((key) => localStorage.getItem(key), key);
const positions = (page: Page) =>
  page
    .locator(".history-entry")
    .evaluateAll((rows) =>
      rows.map((row) => Number((row as HTMLElement).dataset.historyIndex)),
    );
const open = async (page: Page) => {
  await page.getByRole("button", { name: "Battle log", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your battle log", exact: true }),
  ).toBeVisible();
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ key, profile }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify(profile));
    },
    { key, profile },
  );
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).__arena);
});

test("combines live search and filters, shows opponents and clears an empty result", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const before = await saved(page);
  await open(page);
  await expect(page.locator("#history-count")).toHaveText(
    "Showing 10 of 10 saved battles.",
  );
  await expect(page.locator(".history-summary b")).toHaveText([
    "42",
    "12",
    "35",
  ]);
  const search = page.getByRole("searchbox", {
    name: "Search battles",
    exact: true,
  });
  await search.fill("ÉLODIE mini P.E.K.K.A");
  await expect.poll(() => positions(page)).toEqual([1]);
  await expect(search).toBeFocused();
  await expect(page.locator(".history-entry b small")).toBeVisible();
  await expect(page.locator(".history-entry b small")).toHaveText(
    "vs <b>Élodie & King</b>",
  );
  await expect(page.locator(".history-entry small b")).toHaveCount(0);
  await expect(page.locator("#history-count")).toHaveText(
    "Showing 1 of 10 saved battles.",
  );
  await page.screenshot({
    path: info.outputPath("battle-log-search.png"),
    animations: "disabled",
  });
  await page
    .getByRole("combobox", { name: "Result", exact: true })
    .selectOption("blue");
  await expect(
    page.getByRole("heading", { name: "No battles match these filters." }),
  ).toBeVisible();
  await expect(page.locator("[data-replay]")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("");
  await expect(
    page.getByRole("combobox", { name: "Result", exact: true }),
  ).toHaveValue("all");
  await expect
    .poll(() => positions(page))
    .toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  await page
    .getByRole("combobox", { name: "Result", exact: true })
    .selectOption("blue");
  await expect.poll(() => positions(page)).toEqual([2]);
  await page
    .getByRole("combobox", { name: "Mode", exact: true })
    .selectOption("training");
  await expect(page.locator(".history-entry")).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Result", exact: true })
    .selectOption("all");
  await expect.poll(() => positions(page)).toEqual([0]);
  expect(await saved(page)).toBe(before);
  expect(
    await page
      .getByRole("dialog")
      .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("returns from nested details to the same filtered row, focus and scroll position", async ({
  page,
}) => {
  const before = await saved(page);
  await open(page);
  await page
    .getByRole("combobox", { name: "Result", exact: true })
    .selectOption("draw");
  await page
    .getByRole("combobox", { name: "Mode", exact: true })
    .selectOption("classic");
  const details = page.locator('[data-match-details="8"]');
  await details.scrollIntoViewIfNeeded();
  await details.focus();
  const scroll = await page.evaluate(() => ({
    panel: document.querySelector(".modal")!.scrollTop,
    list: document.querySelector(".history-list")!.scrollTop,
  }));
  expect(scroll.list).toBeGreaterThan(0);
  await details.click();
  await expect(page.locator(".match-result span")).toHaveText(
    "vs Royal Guard 8",
  );
  await page.locator("[data-match-card]").first().click();
  await page
    .getByRole("button", { name: "Back to battle details", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Back to battle log", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Result", exact: true }),
  ).toHaveValue("draw");
  await expect(
    page.getByRole("combobox", { name: "Mode", exact: true }),
  ).toHaveValue("classic");
  await expect.poll(() => positions(page)).toEqual([3, 4, 5, 6, 7, 8, 9]);
  await expect(details).toBeFocused();
  const restored = await page.evaluate(() => ({
    panel: document.querySelector(".modal")!.scrollTop,
    list: document.querySelector(".history-list")!.scrollTop,
  }));
  expect(restored.panel).toBeCloseTo(scroll.panel, 0);
  expect(restored.list).toBeCloseTo(scroll.list, 0);
  expect(await saved(page)).toBe(before);
});

test("plays the filtered recording and keeps the search when the log reopens", async ({
  page,
}) => {
  const before = await saved(page);
  await open(page);
  await page
    .getByRole("searchbox", { name: "Search battles", exact: true })
    .fill("Elodie");
  await page.locator('[data-replay="1"]').click();
  await expect(
    page.getByRole("slider", { name: "Replay timeline", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".competitor.enemy b")).toHaveText(
    "<b>Élodie & King</b>",
  );
  await page.locator("#replay-exit").click();
  await open(page);
  await expect(
    page.getByRole("searchbox", { name: "Search battles", exact: true }),
  ).toHaveValue("Elodie");
  await expect.poll(() => positions(page)).toEqual([1]);
  await expect(page.locator('[data-replay="1"]')).toBeFocused();
  expect(await saved(page)).toBe(before);
});

test("preserves filters through a shared replay preview", async ({ page }) => {
  const { id: _id, ...match } = history[1];
  await open(page);
  await page
    .getByRole("searchbox", { name: "Search battles", exact: true })
    .fill("王小明");
  await page
    .getByRole("combobox", { name: "Mode", exact: true })
    .selectOption("double");
  const before = await saved(page);
  await page.locator("#replay-file").setInputFiles({
    name: "shared-replay.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        format: "browser-royale-replay",
        version: 1,
        playerName: "Sender",
        match,
      }),
    ),
  });
  await expect(
    page.getByRole("heading", { name: "Shared replay", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Back to battle log", exact: true })
    .click();
  await expect(
    page.getByRole("searchbox", { name: "Search battles", exact: true }),
  ).toHaveValue("王小明");
  await expect(
    page.getByRole("combobox", { name: "Mode", exact: true }),
  ).toHaveValue("double");
  await expect.poll(() => positions(page)).toEqual([2]);
  await expect(page.locator("#open-replay-file")).toBeFocused();
  expect(await saved(page)).toBe(before);
});

test("keeps the first-battle prompt when there are no saved recordings", async ({
  page,
}) => {
  await page.addInitScript((key) => {
    const profile = JSON.parse(localStorage.getItem(key)!);
    profile.history = [];
    localStorage.setItem(key, JSON.stringify(profile));
  }, key);
  await page.reload();
  await open(page);
  await expect(
    page.getByRole("heading", { name: "Your story starts in the arena." }),
  ).toBeVisible();
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  await expect(page.locator("#open-replay-file")).toBeVisible();
  await page.getByRole("button", { name: /Let's battle/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("filters battle types with other criteria and clears a type-only selection", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const before = await saved(page);
  await open(page);
  const type = page.getByRole("combobox", { name: "Battle type", exact: true });
  const clear = page.getByRole("button", {
    name: "Clear filters",
    exact: true,
  });
  const search = page.getByRole("searchbox", {
    name: "Search battles",
    exact: true,
  });
  await expect(type).toHaveValue("all");
  await expect(clear).toBeDisabled();
  for (const [value, expected] of [
    ["ai", [2, 5, 8, 9]],
    ["friend", [1, 4, 7]],
    ["practice", [0, 3, 6]],
  ] as const) {
    await type.focus();
    await type.selectOption(value);
    await expect(type).toBeFocused();
    await expect.poll(() => positions(page)).toEqual(expected);
    await expect(page.locator("#history-count")).toHaveText(
      `Showing ${expected.length} of 10 saved battles.`,
    );
    await expect(clear).toBeEnabled();
  }
  await search.fill("Royal Guard");
  await page.locator("#history-result").selectOption("draw");
  await page.locator("#history-mode").selectOption("classic");
  await expect.poll(() => positions(page)).toEqual([3, 6]);
  await page.locator("#history-mode").selectOption("double");
  await expect(
    page.getByRole("heading", { name: "No battles match these filters." }),
  ).toBeVisible();
  await clear.click();
  await expect(type).toHaveValue("all");
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  await expect(page.locator("#history-result")).toHaveValue("all");
  await expect(page.locator("#history-mode")).toHaveValue("all");
  await expect
    .poll(() => positions(page))
    .toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  await expect(clear).toBeDisabled();
  await type.selectOption("practice");
  await expect(clear).toBeEnabled();
  await expect(page.locator(".history-entry").first()).toContainText(
    "Practice",
  );
  await page.screenshot({
    path: info.outputPath("battle-type-filter.png"),
    animations: "disabled",
  });
  await clear.click();
  await expect(type).toHaveValue("all");
  await expect(clear).toBeDisabled();
  expect(await saved(page)).toBe(before);
  expect(errors).toEqual([]);
});

test("retains battle type through details, cards, playback and a shared preview", async ({
  page,
}) => {
  const before = await saved(page);
  await open(page);
  await page.locator("#history-type").selectOption("ai");
  await page.locator("#history-search").fill("Royal Guard");
  await page.locator("#history-result").selectOption("draw");
  await page.locator("#history-mode").selectOption("classic");
  await expect.poll(() => positions(page)).toEqual([5, 8]);
  const details = page.locator('[data-match-details="8"]');
  await details.scrollIntoViewIfNeeded();
  await details.focus();
  const scroll = await page.evaluate(() => ({
    panel: document.querySelector(".modal")!.scrollTop,
    list: document.querySelector(".history-list")!.scrollTop,
  }));
  await details.click();
  await expect(page.locator(".match-result span")).toHaveText(
    "vs Royal Guard 8",
  );
  await page.locator("[data-match-card]").first().click();
  await page.locator("#card-back").click();
  await page.locator("#match-log").click();
  await expect(page.locator("#history-type")).toHaveValue("ai");
  await expect(details).toBeFocused();
  expect(
    await page.evaluate(() => ({
      panel: document.querySelector(".modal")!.scrollTop,
      list: document.querySelector(".history-list")!.scrollTop,
    })),
  ).toEqual(scroll);
  await page.locator('[data-replay="8"]').click();
  await expect(page.locator(".competitor.enemy b")).toHaveText("Royal Guard 8");
  await page.locator("#replay-exit").click();
  await open(page);
  await expect(page.locator("#history-type")).toHaveValue("ai");
  await expect(page.locator('[data-replay="8"]')).toBeFocused();
  await expect.poll(() => positions(page)).toEqual([5, 8]);
  const { id: _id, ...match } = history[1];
  await page.locator("#replay-file").setInputFiles({
    name: "friend-replay.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        format: "browser-royale-replay",
        version: 1,
        playerName: "Sender",
        match,
      }),
    ),
  });
  await expect(
    page.getByRole("heading", { name: "Shared replay", exact: true }),
  ).toBeVisible();
  await page.locator("#shared-replay-back").click();
  await expect(page.locator("#history-type")).toHaveValue("ai");
  await expect(page.locator("#history-search")).toHaveValue("Royal Guard");
  await expect(page.locator("#history-result")).toHaveValue("draw");
  await expect(page.locator("#history-mode")).toHaveValue("classic");
  await expect(page.locator("#open-replay-file")).toBeFocused();
  await expect.poll(() => positions(page)).toEqual([5, 8]);
  expect(await saved(page)).toBe(before);
  await page.reload();
  await open(page);
  await expect(page.locator("#history-type")).toHaveValue("all");
  // The existing unload save fills profile defaults omitted by this fixture.
  const original = JSON.parse(before!),
    restored = JSON.parse((await saved(page))!);
  for (const field of Object.keys(original))
    expect(restored[field]).toEqual(original[field]);
});

test("fits battle-type controls on narrow and rotated screens", async ({
  page,
}, info) => {
  await open(page);
  await page.locator("#history-type").selectOption("practice");
  for (const viewport of [
    { width: 320, height: 740 },
    { width: 844, height: 390 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    expect(
      await page
        .getByRole("dialog")
        .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    ).toBe(true);
    for (const control of await page
      .locator(".history-filters input, .history-filters select")
      .all()) {
      const bounds = (await control.boundingBox())!;
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    }
  }
  await page.screenshot({
    path: info.outputPath("battle-type-phone.png"),
    animations: "disabled",
  });
});
