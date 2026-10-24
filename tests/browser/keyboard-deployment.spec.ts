import { test, expect, type Page } from "@playwright/test";
const state = (page: Page) =>
  page.evaluate(() => (window as any).__arena.state);
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0;
    localStorage.setItem(
      "browser-royale.profile.v1",
      JSON.stringify({
        version: 1,
        seenTutorial: true,
        sound: false,
        music: false,
        deck: [
          "knight",
          "skeletons",
          "goblins",
          "spear-goblins",
          "archers",
          "giant",
          "arrows",
          "minion-horde",
        ],
      }),
    );
  });
  await page.goto("/");
  await page.locator(".mode-select").click();
  await page.locator('[data-mode="training"]').click();
  await page.locator("#battle-button").click();
  await expect
    .poll(async () => (await state(page)).intro.blocking, { timeout: 15000 })
    .toBe(false);
});
async function select(page: Page, card: string) {
  const slot = (await state(page)).hand.indexOf(card);
  expect(slot).toBeGreaterThanOrEqual(0);
  await page.keyboard.press(String(slot + 1));
  await expect(page.locator("canvas")).toBeFocused();
  return slot;
}

test("keyboard targeting previews a troop, records the chosen tile and deploys once while Enter is held", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await select(page, "knight");
  await expect(page.locator("canvas")).toHaveAttribute("role", "application");
  await expect(page.locator("canvas")).toHaveAttribute(
    "aria-describedby",
    "keyboard-deployment-instructions",
  );
  expect((await state(page)).placement.point).toEqual({ x: 9, y: 24 });
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("ArrowUp");
  expect((await state(page)).placement.point).toEqual({ x: 7, y: 23.5 });
  expect((await state(page)).placement.valid).toBe(true);
  await expect
    .poll(async () => (await state(page)).placement.nativeCount)
    .toBe(1);
  await expect(page.locator("#keyboard-deployment-status")).toContainText(
    "Target column 7, row 23.5",
  );
  await expect(page.locator("#hand-caption")).toContainText("Enter deploys");
  await page.screenshot({
    path: info.outputPath("keyboard-deployment.png"),
    animations: "disabled",
  });
  await page.keyboard.down("Enter");
  await page.keyboard.down("Enter");
  await page.keyboard.up("Enter");
  expect((await state(page)).selected).toBe(-1);
  await expect(page.locator('#hand [data-native-card="knight"]')).toHaveCount(
    0,
  );
  await expect(page.locator("#keyboard-deployment-status")).toHaveText(
    "Knight deployed.",
  );
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  await page.getByRole("button", { name: "Leave battle", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Watch replay", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  const record = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("browser-royale.profile.v1")!).history[0],
  );
  const commands = record.replay.actions.filter(
    (action: any) => action.team === "blue",
  );
  expect(commands).toHaveLength(1);
  expect(commands[0]).toMatchObject({ card: "knight", x: 7, y: 23.5 });
  await expect(page.locator("canvas")).toHaveAttribute("role", "img");
  expect(errors).toEqual([]);
});

test("keyboard placement retains elixir, territory and occupied-tile checks and stops while paused", async ({
  page,
}) => {
  await select(page, "minion-horde");
  await page.keyboard.press("Enter");
  await expect(
    page.locator('#hand [data-native-card="minion-horde"]'),
  ).toHaveCount(0);
  const slot = await select(page, "knight");
  await expect(page.locator("#keyboard-deployment-status")).toContainText(
    "You need 3 elixir",
  );
  await page.keyboard.press("Enter");
  expect((await state(page)).selected).toBe(slot);
  expect((await state(page)).hand[slot]).toBe("knight");
  for (let i = 0; i < 7; i++) await page.keyboard.press("Shift+ArrowUp");
  expect((await state(page)).placement.point).toEqual({ x: 9, y: 10 });
  expect((await state(page)).placement.valid).toBe(false);
  await expect(page.locator("#keyboard-deployment-status")).toContainText(
    "your side",
  );
  await page.keyboard.press("Enter");
  expect((await state(page)).hand[slot]).toBe("knight");
  for (let i = 0; i < 9; i++) await page.keyboard.press("Shift+ArrowDown");
  expect((await state(page)).placement.point).toEqual({ x: 9, y: 28 });
  await expect(page.locator("#keyboard-deployment-status")).toContainText(
    "occupied",
  );
  await page.keyboard.press("Enter");
  expect((await state(page)).hand[slot]).toBe("knight");
  await page.keyboard.press("Space");
  expect((await state(page)).paused).toBe(true);
  await page.keyboard.press("ArrowLeft");
  expect((await state(page)).placement).toBeNull();
  await page.keyboard.press("Enter");
  expect((await state(page)).hand[slot]).toBe("knight");
  expect((await state(page)).placement?.point ?? null).toBeNull();
  // Enter activates the focused Resume button without deploying the card.
  expect((await state(page)).paused).toBe(false);
  await page.keyboard.press("ArrowUp");
  expect((await state(page)).placement.point).toEqual({ x: 9, y: 27.5 });
  await page.keyboard.press("Escape");
  expect((await state(page)).selected).toBe(-1);
  expect((await state(page)).paused).toBe(false);
  await expect(page.locator("#keyboard-deployment-status")).toHaveText(
    "Deployment cancelled.",
  );
});

test("native hand activation, focus exit, dialogs, arena bounds and mouse takeover cooperate", async ({
  page,
}) => {
  await page.locator('#hand [data-native-card="knight"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("canvas")).toBeFocused();
  expect((await state(page)).placement.point).toEqual({ x: 9, y: 24 });
  await page.keyboard.press("Tab");
  await expect(page.locator("canvas")).not.toBeFocused();
  await page.keyboard.press("ArrowRight");
  expect((await state(page)).placement?.point ?? null).toBeNull();
  await page.locator("#arena-settings").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  const selected = (await state(page)).selected;
  await page.keyboard.press("1");
  expect((await state(page)).selected).toBe(selected);
  await page.keyboard.press("Escape");
  await expect(page.locator("canvas")).toBeFocused();
  for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowLeft");
  for (let i = 0; i < 12; i++) await page.keyboard.press("Shift+ArrowUp");
  expect((await state(page)).placement.point).toEqual({ x: 0.5, y: 0.7 });
  for (let i = 0; i < 9; i++) await page.keyboard.press("Shift+ArrowRight");
  for (let i = 0; i < 16; i++) await page.keyboard.press("Shift+ArrowDown");
  expect((await state(page)).placement.point).toEqual({ x: 17.5, y: 31.3 });
  const point = await page.evaluate(() =>
    (window as any).__arena.project(4, 22),
  );
  await page.mouse.move(point.x, point.y);
  await expect(page.locator("#keyboard-deployment-status")).toHaveText("");
  await expect(page.locator("#hand-caption")).not.toContainText("Arrows aim");
  // WebKit rounds pointer coordinates to device pixels; preserve that picked
  // world point when switching back to the keyboard.
  const mouseTarget = (await state(page)).placement.point;
  expect(Math.abs(mouseTarget.x - 4)).toBeLessThan(0.2);
  expect(Math.abs(mouseTarget.y - 22)).toBeLessThan(0.2);
  await page.keyboard.press("ArrowUp");
  expect((await state(page)).placement.point.x).toBe(mouseTarget.x);
  expect((await state(page)).placement.point.y).toBeCloseTo(
    mouseTarget.y - 0.5,
    9,
  );
});

test("keyboard spells can target the enemy half and keep the exact chosen point in the replay", async ({
  page,
}) => {
  await select(page, "arrows");
  for (let i = 0; i < 7; i++) await page.keyboard.press("Shift+ArrowUp");
  expect((await state(page)).placement.point).toEqual({ x: 9, y: 10 });
  expect((await state(page)).placement.valid).toBe(true);
  await page.keyboard.press("Enter");
  await expect(page.locator('#hand [data-native-card="arrows"]')).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  await page.getByRole("button", { name: "Leave battle", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Watch replay", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  const record = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("browser-royale.profile.v1")!).history[0],
  );
  expect(
    record.replay.actions.filter((action: any) => action.team === "blue"),
  ).toEqual([expect.objectContaining({ card: "arrows", x: 9, y: 10 })]);
});
