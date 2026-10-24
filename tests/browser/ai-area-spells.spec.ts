import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

for (const card of ["rage", "freeze", "poison"] as const)
  test(`the AI uses ${card} for its intended role and avoids refreshing a covered group`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/tests/fixtures/combat.html");
    await page.locator("#scenario").selectOption(`ai-${card}`);
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
    const step = async () => {
      const before = await time();
      await page.locator("#second").click();
      await expect.poll(time).toBeGreaterThan(before + 0.99);
    };
    await step();
    await step();
    expect((await state()).actions).toEqual([]);
    await step();
    expect((await state()).actions).toHaveLength(1);
    expect((await state()).actions[0].card).toBe(card);
    expect(
      (await state()).areas.some(
        (a: any) => a.card === card && a.team === "red",
      ),
    ).toBe(true);
    const affected = (await state()).entities.filter(
      (e: any) => e.team === (card === "rage" ? "red" : "blue"),
    );
    expect(
      affected.some((e: any) => (card === "freeze" ? e.stun > 0 : !!e[card])),
    ).toBe(true);
    const frozen = await state();
    await page.waitForTimeout(160);
    expect(await state()).toEqual(frozen);
    await step();
    await step();
    await step();
    expect((await state()).actions).toHaveLength(1);
    expect(
      (await state()).areas.filter((a: any) => a.card === card),
    ).toHaveLength(1);
    expect(errors).toEqual([]);
  });
