import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";
for (const scenario of ["lane", "center"] as const)
  test(`the ordinary AI timer defends the ${scenario === "lane" ? "weak tower's lane" : "central King approach"}`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/tests/fixtures/combat.html");
    await page.locator("#scenario").selectOption(`ai-defense-${scenario}`);
    await expect(page.locator("#status")).toContainText(
      `${expectedEffects} effects`,
      { timeout: 60000 },
    );
    const output = page.locator("#destruction");
    const state = async () =>
      JSON.parse((await output.getAttribute("data-ai-defense"))!);
    const time = async () =>
      JSON.parse((await output.getAttribute("data-state"))!).time;
    const step = async () => {
      const before = await time();
      await page.locator("#second").click();
      await expect.poll(time).toBeGreaterThan(before + 0.99);
    };
    await expect
      .poll(async () => (await state()).scene)
      .toBe(`ai-defense-${scenario}`);
    expect((await state()).actions).toEqual([]);
    await step();
    await step();
    expect((await state()).actions).toEqual([]);
    await step();
    const result = await state();
    expect(result.actions).toHaveLength(1);
    const action = result.actions[0];
    expect(["mini-pekka", "knight"]).toContain(action.card);
    if (scenario === "lane") {
      expect(result.towers.find((e: any) => e.lane === "right").hp).toBe(100);
      expect(action.x).toBeGreaterThan(13);
      expect(action.x).toBeLessThan(15);
      expect(action.y).toBeCloseTo(9.3);
    } else {
      const attacker = result.targets.find((e: any) => e.card === "knight");
      expect(
        Math.hypot(action.x - attacker.x, action.y - attacker.y),
      ).toBeLessThan(2);
      expect(action.y).toBeCloseTo(attacker.y + 1.3);
    }
    expect(result.elixir).toBeGreaterThanOrEqual(0);
    expect(result.elixir).toBeLessThan(3);
    await page.waitForTimeout(180);
    expect((await state()).actions).toEqual(result.actions);
    if (info.project.name === "desktop" && scenario === "lane")
      await page.screenshot({
        path: info.outputPath("ai-weak-tower-defense.png"),
        animations: "disabled",
      });
    expect(errors).toEqual([]);
  });
