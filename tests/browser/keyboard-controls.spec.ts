import { test, expect, type Page } from "@playwright/test";
import { STARTER_DECK } from "../../src/game/cards";
const state = (page: Page) =>
  page.evaluate(() => (window as any).__arena.state);

test.beforeEach(async ({ page }) => {
  await page.addInitScript((deck) => {
    localStorage.setItem(
      "browser-royale.profile.v1",
      JSON.stringify({
        version: 1,
        seenTutorial: true,
        sound: false,
        music: false,
        history: [
          {
            id: 42,
            date: "2026-10-24T12:00:00.000Z",
            mode: "classic",
            winner: "red",
            crowns: [0, 0],
            replay: {
              version: 5,
              seed: 1,
              mode: "classic",
              deck,
              enemyDeck: deck,
              actions: [],
              duration: 600,
            },
          },
        ],
      }),
    );
  }, STARTER_DECK);
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).__arena);
});
async function replay(page: Page) {
  await page.getByRole("button", { name: "Battle log", exact: true }).click();
  await page.locator("[data-replay]").click();
  await expect.poll(async () => (await state(page)).screen).toBe("replay");
}

test("Space activates focused replay speed, pause, resume and exit controls", async ({
  page,
}) => {
  const canvas = page.locator("#arena-canvas canvas");
  await expect(canvas).toHaveAttribute("role", "img");
  await expect(canvas).toHaveAttribute(
    "aria-label",
    "Goblin Stadium arena preview.",
  );
  await replay(page);
  await expect(canvas).toHaveAttribute("role", "application");
  await expect(canvas).toHaveAttribute("aria-label", "Battle replay arena.");
  await expect(canvas).toHaveAttribute(
    "aria-describedby",
    "replay-keyboard-help",
  );
  await expect(canvas).toHaveAttribute(
    "aria-keyshortcuts",
    "1 2 3 4 ArrowLeft ArrowRight Home End [ ] Space",
  );
  const speed = page.locator("#replay-speed");
  await speed.focus();
  await page.keyboard.press("Space");
  await expect(speed).toHaveText("2×");
  expect((await state(page)).paused).toBe(false);
  const play = page.locator("#replay-play");
  await play.focus();
  await page.keyboard.press("Space");
  await expect(play).toHaveAttribute("aria-label", "Resume replay");
  expect((await state(page)).paused).toBe(true);
  await page.keyboard.press("Space");
  await expect(play).toHaveAttribute("aria-label", "Pause replay");
  expect((await state(page)).paused).toBe(false);
  await page.locator("#replay-exit").focus();
  await page.keyboard.press("Space");
  await expect.poll(async () => (await state(page)).screen).toBe("lobby");
  await expect(canvas).toHaveAttribute("role", "img");
  await expect(canvas).toHaveAttribute(
    "aria-label",
    "Goblin Stadium arena preview.",
  );
  await expect(canvas).not.toHaveAttribute("aria-describedby", /./);
  await expect(canvas).not.toHaveAttribute("aria-keyshortcuts", /./);
});

test("Space restarts a completed replay through its focused native button", async ({
  page,
}) => {
  const before = await page.evaluate(() =>
    localStorage.getItem("browser-royale.profile.v1"),
  );
  await replay(page);
  const timeline = page.getByRole("slider", { name: "Replay timeline" });
  await timeline.focus();
  await timeline.press("End");
  const restart = page.getByRole("button", {
    name: "Restart replay",
    exact: true,
  });
  await expect(restart).toBeVisible();
  await expect(page.locator("#arena-canvas canvas")).toHaveAttribute(
    "role",
    "application",
  );
  await expect(page.locator("#arena-canvas canvas")).toHaveAttribute(
    "aria-describedby",
    "replay-keyboard-help",
  );
  await restart.focus();
  await page.keyboard.press("Space");
  await expect(page.locator("#replay-play")).toHaveAttribute(
    "aria-label",
    "Pause replay",
  );
  expect((await state(page)).winner).toBeNull();
  expect((await state(page)).time).toBeLessThan(1);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("browser-royale.profile.v1"),
    ),
  ).toBe(before);
});

test("held battle shortcuts act once and focused emote buttons keep native Space activation", async ({
  page,
}) => {
  await page.locator("#battle-button").click();
  await expect
    .poll(async () => (await state(page)).intro.blocking, { timeout: 15000 })
    .toBe(false);
  await page.locator("canvas").focus();
  await page.keyboard.down("1");
  expect((await state(page)).selected).toBe(0);
  await page.keyboard.down("1");
  expect((await state(page)).selected).toBe(0);
  await page.keyboard.up("1");
  await page.keyboard.down("Escape");
  expect((await state(page)).selected).toBe(-1);
  await page.keyboard.down("Escape");
  expect((await state(page)).paused).toBe(false);
  await page.keyboard.up("Escape");
  await page.keyboard.down("Space");
  expect((await state(page)).paused).toBe(true);
  await page.keyboard.down("Space");
  expect((await state(page)).paused).toBe(true);
  await page.keyboard.up("Space");
  await page.locator("#resume-button").focus();
  await page.keyboard.press("Space");
  expect((await state(page)).paused).toBe(false);
  const emotes = page.getByRole("button", { name: "King emotes", exact: true });
  await expect(emotes).toBeEnabled();
  await emotes.focus();
  await page.keyboard.press("Space");
  await expect(emotes).toHaveAttribute("aria-expanded", "true");
  expect((await state(page)).paused).toBe(false);
  await page.keyboard.press("Escape");
  await expect(emotes).toHaveAttribute("aria-expanded", "false");
  expect((await state(page)).paused).toBe(false);
  await page.locator("#arena-settings").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect((await state(page)).paused).toBe(true);
  await page.keyboard.down("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect((await state(page)).paused).toBe(false);
  await page.keyboard.down("Escape");
  expect((await state(page)).paused).toBe(false);
  await page.keyboard.up("Escape");
});
