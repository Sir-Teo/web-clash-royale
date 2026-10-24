import { test, expect } from "@playwright/test";
import { expectedCards } from "./native-assets";

test("Rocket can be added to a deck and cast through the real battle controls", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    Math.random = () => 0;
    if (!localStorage.getItem("browser-royale.profile.v1"))
      localStorage.setItem(
        "browser-royale.profile.v1",
        JSON.stringify({
          version: 1,
          seenTutorial: true,
          sound: false,
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
  await page.locator('[data-collection="rocket"]').click();
  await expect(page.locator('[data-edit-slot="7"]')).toHaveAttribute(
    "aria-label",
    "Rocket, 6 elixir",
  );
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.reload();
  await expect(
    page.locator('#deck-preview [data-card-info="rocket"]'),
  ).toBeVisible();
  await page.locator("#battle-button").click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__arena.state.intro.blocking),
    )
    .toBe(false);
  const rocket = page.locator('#hand [data-native-card="rocket"]');
  await expect(rocket).toBeVisible();
  await expect(rocket).not.toHaveClass(/unaffordable/, { timeout: 15000 });
  await expect(rocket).toBeEnabled();
  await rocket.click();
  const point = await page.evaluate(() =>
    (window as any).__arena.project(4, 6),
  );
  if (await page.evaluate(() => navigator.maxTouchPoints > 0))
    await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__arena.state.projectileArtwork.filter(
            (p: any) => p.sprites[0]?.name === "projectile_rocket",
          ).length,
      ),
    )
    .toBe(1);
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  const held = await page.evaluate(
    () => (window as any).__arena.state.projectileArtwork,
  );
  await page.waitForTimeout(180);
  expect(
    await page.evaluate(() => (window as any).__arena.state.projectileArtwork),
  ).toEqual(held);
  await page.screenshot({
    path: info.outputPath("rocket-real-battle.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Leave battle", exact: true }).click();
  expect(errors).toEqual([]);
});
