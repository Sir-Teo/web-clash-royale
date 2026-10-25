import { test, expect } from "@playwright/test";
import { expectedCards, expectedAnimations } from "./native-assets";

test("Minion Horde saves from the editor, previews six native flyers and survives replay seeking", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Math.random = () => 0;
    if (!localStorage.getItem("browser-royale.profile.v1"))
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
            "musketeer",
          ],
        }),
      );
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: `Cards ${expectedCards}`, exact: true })
    .click();
  await page.locator('[data-edit-slot="7"]').click();
  await page.locator('[data-collection="minion-horde"]').click();
  await expect(page.locator('[data-edit-slot="7"]')).toHaveAttribute(
    "aria-label",
    "Minion Horde, 5 elixir",
  );
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.reload();
  await expect(
    page.locator('#deck-preview [data-card-info="minion-horde"]'),
  ).toBeVisible();
  await page.locator(".mode-select").click();
  await page.locator('[data-mode="training"]').click();
  await page.locator("#battle-button").click();
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__arena.state.intro.blocking),
      { timeout: 15000 },
    )
    .toBe(false);
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__arena.state.loadedAnimations),
      { timeout: 30000 },
    )
    .toBe(expectedAnimations);
  await page.locator('#hand [data-native-card="minion-horde"]').click();
  const point = await page.evaluate(() =>
    (window as any).__arena.project(4, 22),
  );
  await page.mouse.move(point.x, point.y);
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__arena.state.placement?.nativeCount),
    )
    .toBe(6);
  expect(
    await page.evaluate(() => (window as any).__arena.state.placement.valid),
  ).toBe(true);
  if (await page.evaluate(() => navigator.maxTouchPoints > 0))
    await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  await expect(
    page.locator('#hand [data-native-card="minion-horde"]'),
  ).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => (window as any).__arena.state.actions))
    .toBeGreaterThanOrEqual(1);
  await expect
    .poll(() => page.evaluate(() => (window as any).__arena.state.time))
    .toBeGreaterThan(1);
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  const held = await page.evaluate(() => (window as any).__arena.state);
  expect(held.troops).toBeGreaterThanOrEqual(6);
  expect(held.elixir).toBeLessThan(5);
  await page.screenshot({
    path: info.outputPath("minion-horde-battle.png"),
    style: ".pause-cover { visibility: hidden; }",
    animations: "disabled",
  });
  expect((await page.evaluate(() => (window as any).__arena.state)).time).toBe(
    held.time,
  );
  await page.getByRole("button", { name: "Leave battle", exact: true }).click();
  await page.getByRole("button", { name: "Watch replay", exact: true }).click();
  await page.getByRole("button", { name: "Pause replay", exact: true }).click();
  const seek = page.getByRole("slider", { name: "Replay timeline" });
  await seek.focus();
  await seek.press("End");
  await expect(
    page.getByRole("button", { name: "Restart replay", exact: true }),
  ).toBeVisible();
  expect(
    (await page.evaluate(() => (window as any).__arena.state)).troops,
  ).toBeGreaterThanOrEqual(6);
  await seek.press("Home");
  expect((await page.evaluate(() => (window as any).__arena.state)).time).toBe(
    0,
  );
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("browser-royale.profile.v1")!),
  );
  expect(saved.deck).toContain("minion-horde");
  expect(
    saved.history[0].replay.actions.some(
      (a: any) => a.team === "blue" && a.card === "minion-horde",
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
