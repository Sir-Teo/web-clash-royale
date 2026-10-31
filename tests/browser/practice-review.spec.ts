import { test, expect, type Page } from "@playwright/test";
import { PRESETS, STARTER_DECK } from "../../src/game/cards";
import type { Mode } from "../../src/game/engine";
import type { Profile, RecordEntry } from "../../src/game/profile";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const playerDeck = [...STARTER_DECK];
const opponentDeck = [...PRESETS[2].deck];
function record(
  id: number,
  date: string,
  options: {
    practice?: boolean;
    mode?: Mode;
    red?: boolean;
    reversed?: boolean;
  } = {},
): RecordEntry {
  const mode = options.mode ?? "classic";
  const own = options.reversed ? opponentDeck : playerDeck;
  const enemy = options.reversed ? playerDeck : opponentDeck;
  return {
    id,
    date,
    winner: "red",
    crowns: [0, 0],
    mode,
    ...(options.practice === false ? {} : { practice: true }),
    opponent: id === 2 ? "Latest Rival" : `Rival ${id}`,
    playerName: id === 2 ? "Latest Learner" : "Earlier Learner",
    opponentType: "ai",
    replay: {
      version: 56,
      rulesFamily: "origin",
      seed: id,
      mode,
      deck: [...(options.red ? enemy : own)],
      enemyDeck: [...(options.red ? own : enemy)],
      ...(options.red ? { perspective: "red" } : {}),
      actions: [],
      duration: 600,
    },
  };
}
const initial: Profile = {
  version: 1,
  name: "Practice Learner",
  trophies: 321,
  best: 400,
  gold: 4567,
  wins: 4,
  battles: 12,
  crowns: 15,
  chests: ["gold"],
  deck: [...opponentDeck],
  decks: [[...playerDeck], [...PRESETS[1].deck], [...opponentDeck]],
  activeDeck: 2,
  sound: false,
  music: false,
  emotesMuted: false,
  seenTutorial: true,
  history: [
    record(1, "2026-10-29T12:00:00.000Z"),
    record(2, "2026-10-30T12:00:00.000Z", { red: true }),
    record(3, "2026-10-31T12:00:00.000Z", { practice: false }),
    record(4, "2026-10-31T12:00:00.000Z", { mode: "double" }),
    record(5, "2026-10-31T12:00:00.000Z", { reversed: true }),
  ],
};
const state = (page: Page) =>
  page.evaluate(() => (window as any).__arena?.state);
const saved = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
const own = (page: Page) =>
  page.getByRole("combobox", { name: "Your practice deck", exact: true });
const enemy = (page: Page) =>
  page.getByRole("combobox", { name: "Practice opponent", exact: true });
const pace = (page: Page) =>
  page.getByRole("combobox", { name: "Practice pace", exact: true });
const review = (page: Page) =>
  page.getByRole("button", { name: "Review latest practice", exact: true });

test.beforeEach(async ({ page }, info) => {
  await page.addInitScript(
    ({ key, initial }) => {
      localStorage.setItem(key, JSON.stringify(initial));
      Math.random = () => 0;
    },
    { key, initial },
  );
  if (info.project.name !== "desktop")
    await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");
  await expect
    .poll(async () => (await state(page))?.loadedCards, { timeout: 60000 })
    .toBe(expectedCards);
});

test("reviews the newest matching red recording and returns to the same setup through replay restart", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const before = await saved(page);
  await page.locator(".mode-select").click();
  await page
    .getByRole("button", { name: "Choose a practice opponent", exact: true })
    .click();
  await own(page).selectOption("0");
  await enemy(page).selectOption("19");
  await pace(page).selectOption("classic");
  await page.locator("#practice-search").fill("saved");
  await expect(review(page)).toBeVisible();
  await review(page).scrollIntoViewIfNeeded();
  await review(page).focus();
  const scroll = await page.getByRole("dialog").evaluate((e) => e.scrollTop);
  await own(page).evaluate((e) => {
    (window as any).__practiceChoiceBeforeReview = e;
  });
  expect((await review(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({
    path: info.outputPath("practice-review-action.png"),
    animations: "disabled",
  });
  if (info.project.name === "desktop") await review(page).press("Enter");
  else await review(page).tap();
  await expect.poll(async () => (await state(page)).screen).toBe("replay");
  await expect(page.locator(".match-bottom .player-name")).toHaveText(
    "Latest Learner",
  );
  await expect(page.locator(".competitor.enemy b")).toHaveText("Latest Rival");
  expect(
    (await state(page)).hand.every((id: string) => playerDeck.includes(id)),
  ).toBe(true);
  await expect(page.locator("#replay-exit")).toHaveAttribute(
    "aria-label",
    "Back to practice",
  );
  await expect(page.locator("#replay-exit")).toHaveText("Back");
  await page.screenshot({
    path: info.outputPath("practice-review-replay.png"),
    animations: "disabled",
  });
  await page.locator("#replay-speed").click();
  await page
    .getByRole("button", { name: "View opponent side", exact: true })
    .click();
  await page.locator("#replay-seek").fill("100");
  await page
    .getByRole("button", { name: "Restart replay", exact: true })
    .click();
  await expect(page.locator("#replay-side")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("#replay-speed")).toHaveText("2×");
  await expect(page.locator("#replay-exit")).toHaveAttribute(
    "aria-label",
    "Back to practice",
  );
  await page.locator("#replay-exit").focus();
  await page.keyboard.press("Space");
  await expect(page.locator("#modal-title")).toHaveText(
    "Choose a practice opponent",
  );
  await expect(review(page)).toBeFocused();
  await expect(own(page)).toHaveValue("0");
  await expect(enemy(page)).toHaveValue("19");
  await expect(pace(page)).toHaveValue("classic");
  await expect(page.locator("#practice-search")).toHaveValue("saved");
  expect(
    await own(page).evaluate(
      (e) => e === (window as any).__practiceChoiceBeforeReview,
    ),
  ).toBe(true);
  expect(
    await page.getByRole("dialog").evaluate((e) => e.scrollTop),
  ).toBeCloseTo(scroll, 0);
  expect(await saved(page)).toEqual(before);
  await pace(page).selectOption("training");
  await expect(review(page)).toBeHidden();
  await pace(page).selectOption("classic");
  await expect(review(page)).toBeVisible();
  await page.locator("#practice-search").fill("no such matchup");
  await expect(review(page)).toBeHidden();
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(review(page)).toBeVisible();
  expect(await saved(page)).toEqual(before);
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("button", { name: "Battle log", exact: true }).click();
  await page.locator('[data-replay="1"]').click();
  await expect(page.locator("#replay-exit")).toHaveText("Exit");
  await page.locator("#replay-exit").click();
  expect((await state(page)).screen).toBe("lobby");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("reviews a newly completed unlisted practice and retains its temporary deck for the next setup", async ({
  page,
}) => {
  test.setTimeout(120000);
  const custom = [
    "rocket",
    "rage",
    "hog-rider",
    "musketeer",
    "cannon",
    "skeletons",
    "goblins",
    "zap",
  ];
  await page
    .getByRole("button", { name: `Cards ${expectedCards}`, exact: true })
    .click();
  await page.getByRole("button", { name: "Deck codes", exact: true }).click();
  await page
    .getByLabel("PASTE A SHARED DECK CODE", { exact: true })
    .fill("BRA-DECK-1:" + custom.join(","));
  await page.getByRole("button", { name: "Preview deck", exact: true }).click();
  await pace(page).selectOption("training");
  await page
    .getByRole("button", { name: "Practice against this deck", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  await page.getByRole("button", { name: "Leave battle", exact: true }).click();
  await page
    .getByRole("button", { name: "Change practice matchup", exact: true })
    .click({ timeout: 20000 });
  await expect(enemy(page)).toHaveValue("20");
  await expect(review(page)).toBeVisible();
  const afterBattle = await saved(page);
  await review(page).click();
  await expect(page.locator(".match-bottom .player-name")).toHaveText(
    initial.name,
  );
  await expect(page.locator(".competitor.enemy b")).toHaveText("Shared deck");
  expect((await state(page)).enemyDeck).toEqual(custom);
  await page
    .getByRole("button", { name: "Back to practice", exact: true })
    .click();
  await expect(own(page)).toHaveValue("2");
  await expect(enemy(page)).toHaveValue("20");
  await expect(pace(page)).toHaveValue("training");
  await expect(
    enemy(page).locator('optgroup[label="Previous practice"] option'),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Swap decks", exact: true }).click();
  await expect(own(page)).toHaveValue("previous");
  await expect(enemy(page)).toHaveValue("19");
  expect(
    await page
      .locator('[data-practice-side="yours"] [data-practice-card]')
      .evaluateAll((cards) =>
        cards.map((card) => (card as HTMLElement).dataset.nativeCard),
      ),
  ).toEqual(custom);
  expect(await saved(page)).toEqual(afterBattle);
});
