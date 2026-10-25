import { expect, test } from "@playwright/test";
import { expectedEffects } from "./native-assets";

for (const direction of ["out", "in"]) {
  test(`Tornado ${direction}: spell reservations follow the real Fireball contact`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(
      `/tests/fixtures/combat.html?scene=ai-pulled-reserve-${direction}`,
    );
    await expect(page.locator("#status")).toContainText(
      `${expectedEffects} effects`,
      { timeout: 60000 },
    );
    const output = page.locator("#destruction");
    const state = async () =>
      JSON.parse((await output.getAttribute("data-ai-areas"))!);
    const actions = async () =>
      JSON.parse((await output.getAttribute("data-ai-defense"))!).actions;
    const advance = async () => {
      const before = (await state()).time;
      await page.locator("#second").click();
      await expect
        .poll(async () => (await state()).time)
        .toBeGreaterThan(before + 0.99);
    };
    await advance();
    await advance();
    expect(await actions()).toEqual([]);
    await advance();
    const expected = [
      ["tornado", 73],
      ["fireball", 73],
      ...(direction === "out" ? [["zap", 74]] : []),
    ];
    expect((await actions()).map((a: any) => [a.card, a.tick])).toEqual(
      expected,
    );
    const pending = (await state()).entities.filter(
      (e: any) => e.card === "wizard",
    );
    expect(pending).toHaveLength(3);
    expect(
      pending.every((e: any) => e.hp === (direction === "out" ? 261 : 453)),
    ).toBe(true);
    await advance();
    await advance();
    expect((await actions()).map((a: any) => [a.card, a.tick])).toEqual(
      expected,
    );
    const result = await state();
    const wizards = result.entities.filter((e: any) => e.card === "wizard");
    const spells = JSON.parse((await output.getAttribute("data-ai-spells"))!);
    if (direction === "in") {
      expect(wizards).toHaveLength(0);
      expect(spells.hand).toContain("zap");
      expect(spells.elixir).toBeGreaterThan(2);
    } else {
      expect(wizards).toHaveLength(3);
      expect(wizards.every((e: any) => e.hp === 73)).toBe(true);
      expect(spells.elixir).toBeLessThan(2);
    }
    expect(result.winner).toBeNull();
    await page.screenshot({
      path: info.outputPath(`pulled-reservations-${direction}.png`),
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
}
