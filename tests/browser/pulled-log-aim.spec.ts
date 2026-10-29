import { expect, test } from "@playwright/test";
import { expectedEffects } from "./native-assets";
import { CARD_MAP } from "../../src/game/cards";

for (const scene of [
  "ai-pulled-aim-log",
  "ai-pulled-aim-log-mirror",
  "ai-pulled-aim-log-short",
  "ai-pulled-log-legal",
]) {
  test(`${scene}: the ordinary AI timer rolls through the known pull with native artwork`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/tests/fixtures/combat.html?scene=${scene}`);
    await expect(page.locator("#status")).toContainText(
      `${expectedEffects} effects`,
      { timeout: 60000 },
    );
    const output = page.locator("#destruction");
    const data = async (name: string) =>
      JSON.parse((await output.getAttribute(name))!);
    const state = () => data("data-ai-areas");
    const defense = () => data("data-ai-defense");
    const shots = () => data("data-projectiles");
    const advance = async (selector: string, amount: number) => {
      const before = (await state()).time;
      await page.locator(selector).click();
      await expect
        .poll(async () => (await state()).time)
        .toBeGreaterThan(before + amount - 0.001);
    };
    await advance("#second", 1);
    await advance("#second", 1);
    expect(
      (await defense()).actions.filter((a: any) => a.team === "red"),
    ).toEqual([]);
    for (let n = 0; n < 5; n++) await advance("#step", 0.1);
    const actions = (await defense()).actions;
    const spells = actions.filter((a: any) => a.team === "red");
    expect(spells.map((a: any) => [a.card, a.tick])).toEqual([
      ["tornado", 73],
      [scene.endsWith("mirror") ? "mirror" : "log", 74],
    ]);
    const cast = spells[1];
    expect(cast.y).toBeLessThanOrEqual(14.5);
    if (!scene.endsWith("short")) expect(cast.x).toBeGreaterThan(5.5);
    expect((await defense()).elixir).toBeGreaterThanOrEqual(0);
    expect(
      (await shots()).some((p: any) =>
        p.sprites.some((sprite: any) => sprite.name === "log_projectile"),
      ),
    ).toBe(true);
    for (let n = 0; n < 5; n++) await advance("#step", 0.1);
    expect(
      (await shots()).some((p: any) =>
        p.sprites.some(
          (sprite: any) => sprite.name === "log_roll_projectile_red",
        ),
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`${scene}-roll.png`),
      fullPage: true,
    });
    for (let n = 0; n < 3; n++) await advance("#second", 1);
    const after = await defense();
    expect(after.actions).toEqual(actions);
    const hits = after.logHits.filter(
      (hit: any) => hit.y < 23 && hit.value === CARD_MAP.log.damage,
    );
    expect(hits).toHaveLength(scene.endsWith("legal") ? 1 : 3);
    expect(
      (await state()).entities.filter((e: any) => e.card === "wizard"),
    ).toHaveLength(0);
    expect(after.enemyKingActive).toBe(false);
    expect((await state()).winner).toBeNull();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
}
