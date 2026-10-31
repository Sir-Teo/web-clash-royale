import { test, expect } from "@playwright/test";
import { PRESETS, STARTER_DECK, type CardId } from "../../src/game/cards";
import type { Profile, RecordEntry } from "../../src/game/profile";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const decks = [[...STARTER_DECK], [...PRESETS[1].deck], [...PRESETS[2].deck]];
function entry(
  id: number,
  winner: RecordEntry["winner"],
  player: CardId[],
  opponent: CardId[],
  mode: RecordEntry["mode"] = "double",
  red = false,
  practice = true,
): RecordEntry {
  return {
    id,
    date: "2026-10-31T12:00:00.000Z",
    winner,
    crowns: [0, 0],
    mode,
    opponent: "Old opponent label",
    opponentType: "ai",
    ...(practice ? { practice: true } : {}),
    replay: {
      version: 56,
      rulesFamily: "origin",
      seed: id,
      mode,
      actions: [],
      duration: 0,
      deck: [...(red ? opponent : player)],
      enemyDeck: [...(red ? player : opponent)],
      ...(red ? { perspective: "red" } : {}),
    },
  };
}
const initial: Profile = {
  version: 1,
  name: "Practice Student",
  trophies: 321,
  best: 400,
  gold: 4567,
  wins: 4,
  battles: 12,
  crowns: 15,
  chests: ["gold"],
  deck: [...decks[2]],
  decks,
  activeDeck: 2,
  sound: false,
  music: false,
  emotesMuted: false,
  seenTutorial: true,
  history: [
    entry(1, "blue", decks[0], decks[2]),
    entry(2, "red", decks[0], decks[2], "double", true),
    entry(3, "draw", [...decks[0]].reverse(), [...decks[2]].reverse()),
    entry(4, "blue", decks[0], decks[2], "training"),
    entry(5, "blue", decks[1], decks[2]),
    entry(6, "blue", decks[0], decks[2], "double", false, false),
    {
      ...entry(7, "blue", decks[0], decks[2], "double", false, false),
      opponentType: "friend",
    },
    entry(8, "blue", decks[0], decks[1]),
  ],
};

test("practice results follow both deck compositions and pace, then include a newly finished attempt", async ({
  page,
}, info) => {
  test.setTimeout(150000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
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
    .poll(
      () => page.evaluate(() => (window as any).__arena?.state.loadedCards),
      { timeout: 60000 },
    )
    .toBe(expectedCards);
  const before = await page.evaluate((key) => localStorage.getItem(key), key);
  await page.locator(".mode-select").click();
  await page
    .getByRole("button", { name: "Choose a practice opponent", exact: true })
    .click();
  const own = page.getByRole("combobox", {
    name: "Your practice deck",
    exact: true,
  });
  const opponent = page.getByRole("combobox", {
    name: "Practice opponent",
    exact: true,
  });
  const pace = page.getByRole("combobox", {
    name: "Practice pace",
    exact: true,
  });
  const summary = page.locator("#practice-record");
  await own.selectOption("0");
  await opponent.selectOption("19");
  await pace.selectOption("double");
  await expect(summary).toContainText("1 win · 1 loss · 1 draw");
  await expect(summary.locator("small")).toHaveText(
    "From your current battle log.",
  );
  await expect(summary).toHaveAttribute("role", "status");
  for (const side of ["yours", "opponent"])
    await page
      .locator(`[data-practice-card="${side}-0"]`)
      .evaluate((e) => e.setAttribute("data-retained", "yes"));
  await pace.focus();
  await pace.selectOption("training");
  await expect(pace).toBeFocused();
  await expect(summary).toContainText("1 win · 0 losses · 0 draws");
  for (const side of ["yours", "opponent"])
    await expect(
      page.locator(`[data-practice-card="${side}-0"]`),
    ).toHaveAttribute("data-retained", "yes");
  await pace.selectOption("classic");
  await expect(summary).toContainText(
    "No saved practice for these decks at this pace.",
  );
  await pace.selectOption("double");
  await own.selectOption("1");
  await expect(summary).toContainText("1 win · 0 losses · 0 draws");
  await own.selectOption("0");
  await opponent.selectOption("18");
  await expect(summary).toContainText("1 win · 0 losses · 0 draws");
  const search = page.getByRole("searchbox", { name: "Find a matchup" });
  await search.fill("no matching opponent");
  await expect(summary).toBeHidden();
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(search).toBeFocused();
  await expect(summary).toBeVisible();
  await opponent.selectOption("19");
  await expect(summary).toContainText("1 win · 1 loss · 1 draw");
  const original = await summary.elementHandle();
  const card = page.locator('[data-practice-card="opponent-0"]');
  if (info.project.name === "desktop") await card.click();
  else await card.tap();
  await page
    .getByRole("button", { name: "Back to practice decks", exact: true })
    .click();
  await expect(card).toBeFocused();
  expect(
    await summary.evaluate(
      (element, original) => element === original,
      original,
    ),
  ).toBe(true);
  await expect(summary).toContainText("1 win · 1 loss · 1 draw");
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    before,
  );
  expect(
    await page
      .getByRole("dialog")
      .evaluate((e) => e.scrollWidth <= e.clientWidth),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Start practice", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  await page.getByRole("button", { name: "Leave battle", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Change practice matchup", exact: true }),
  ).toBeVisible({ timeout: 20000 });
  await page
    .getByRole("button", { name: "Change practice matchup", exact: true })
    .click();
  await expect(own).toHaveValue("0");
  await expect(opponent).toHaveValue("19");
  await expect(pace).toHaveValue("double");
  await expect(summary).toContainText("1 win · 2 losses · 1 draw");
  const after = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    key,
  );
  expect(after.battles).toBe(initial.battles + 1);
  expect(after.history).toHaveLength(initial.history.length + 1);
  expect(after.decks).toEqual(initial.decks);
  expect(after.activeDeck).toBe(initial.activeDeck);
  expect(after.trophies).toBe(initial.trophies);
  expect(after.gold).toBe(initial.gold);
  await summary.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath("practice-saved-results.png"),
    animations: "disabled",
  });
  expect(errors).toEqual([]);
});
