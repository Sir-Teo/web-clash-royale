import { expect, test } from "@playwright/test";
import { expectedEffects } from "./native-assets";

for (const variant of ["win", "preserve"]) {
  test(`Tornado ${variant}: the ordinary AI timer keeps a Lightning King finisher`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(
      `/tests/fixtures/combat.html?scene=ai-tornado-lightning-${variant}`,
    );
    await expect(page.locator("#status")).toContainText(
      `${expectedEffects} effects`,
      { timeout: 60000 },
    );
    const diagnostic = page.locator("#destruction");
    const state = async () =>
      JSON.parse((await diagnostic.getAttribute("data-ai-areas"))!);
    const actions = async () =>
      JSON.parse((await diagnostic.getAttribute("data-ai-defense"))!).actions;
    for (let i = 0; i < 2; i++) {
      const before = (await state()).time;
      await page.locator("#second").click();
      await expect
        .poll(async () => (await state()).time)
        .toBeGreaterThan(before + 0.99);
    }
    expect((await actions()).map((a: any) => [a.card, a.tick])).toEqual([
      ["lightning", 46],
    ]);
    await page.locator("#second").click();
    await expect.poll(async () => (await state()).winner).toBe("red");
    const accepted = await actions();
    expect(accepted.map((a: any) => [a.card, a.tick])).toEqual([
      ["lightning", 46],
      ["tornado", 74],
    ]);
    expect(accepted[1].x).toBeGreaterThan(13.25);
    const result = await state();
    expect(result.time).toBeCloseTo(89 / 30, 8);
    expect(result.crowns.red).toBe(3);
    expect(result.reason).toBe("King Tower destroyed");
    const giant = result.entities.find((e: any) => e.card === "giant");
    expect(giant.hp).toBe(400);
    expect(giant.x).toBeGreaterThan(13.25);
    expect(
      JSON.parse((await diagnostic.getAttribute("data-attack-impacts"))!)
        .lightning,
    ).toBe(3);
    await page.screenshot({
      path: info.outputPath(`tornado-lightning-${variant}.png`),
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
}
