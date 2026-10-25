import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";
import { CARD_MAP } from "../../src/game/cards";

for (const card of ["heal", "clone"] as const)
  test(`AI ${card} supports its own push through the ordinary decision timer`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/tests/fixtures/combat.html?scene=ai-${card}`);
    await expect(page.locator("#status")).toContainText(
      `${expectedEffects} effects`,
      { timeout: 60000 },
    );
    const output = page.locator("#destruction");
    const state = async () =>
      JSON.parse((await output.getAttribute("data-ai-areas"))!);
    const time = async () =>
      JSON.parse((await output.getAttribute("data-state"))!).time;
    await expect.poll(async () => (await state()).scene).toBe(`ai-${card}`);
    const original = (await state()).entities.filter(
      (e: any) => e.team === "red",
    );
    expect(original).toHaveLength(2);
    const step = async () => {
      const before = await time();
      await page.locator("#second").click();
      await expect.poll(time).toBeGreaterThan(before + 0.99);
    };
    await step();
    await step();
    expect((await state()).actions).toEqual([]);
    const ready = (await state()).entities.filter((e: any) => e.team === "red");
    expect(ready.every((e: any) => e.deploy > 0)).toBe(true);
    await step();
    const after = await state();
    expect(after.actions).toHaveLength(1);
    expect(after.actions[0]).toMatchObject({ card, team: "red", y: 20 });
    for (const friend of ready)
      expect(
        Math.hypot(
          after.actions[0].x - friend.x,
          after.actions[0].y - friend.y,
        ),
      ).toBeLessThan(CARD_MAP[card].radius! + friend.radius);
    expect(after.areas).toEqual(
      expect.arrayContaining([expect.objectContaining({ card, team: "red" })]),
    );
    const friends = after.entities.filter((e: any) => e.team === "red");
    if (card === "heal") {
      expect(friends).toHaveLength(2);
      expect(
        friends.every(
          (e: any, i: number) =>
            e.hp > original[i].hp && e.hp <= e.maxHp && !!e.heal,
        ),
      ).toBe(true);
    } else {
      const copies = friends.filter((e: any) => e.clone);
      expect(copies).toHaveLength(2);
      expect(copies.every((e: any) => e.hp === 1 && e.maxHp === 1)).toBe(true);
    }
    await page.waitForTimeout(160);
    expect(await state()).toEqual(after);
    await page.screenshot({
      path: info.outputPath(`ai-${card}.png`),
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
