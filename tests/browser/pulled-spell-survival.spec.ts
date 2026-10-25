import { expect, test } from "@playwright/test";
import { expectedEffects } from "./native-assets";

for (const card of ["fireball", "rocket"]) {
  test(`${card}: the AI compares impact time with the current Tornado kill`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(
      `/tests/fixtures/combat.html?scene=ai-pulled-aim-doomed-${card}`,
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
      ...(card === "fireball" ? [[card, 74]] : []),
    ];
    expect((await actions()).map((a: any) => [a.card, a.tick])).toEqual(
      expected,
    );
    const pending = (await state()).entities.filter(
      (e: any) => e.card === "wizard",
    );
    expect(pending).toHaveLength(3);
    expect(pending.every((e: any) => e.hp === 153)).toBe(true);
    await advance();
    await advance();
    expect((await actions()).map((a: any) => [a.card, a.tick])).toEqual(
      expected,
    );
    expect(
      (await state()).entities.filter((e: any) => e.card === "wizard"),
    ).toHaveLength(0);
    if (card === "rocket") {
      const spells = JSON.parse((await output.getAttribute("data-ai-spells"))!);
      expect(spells.hand).toContain("rocket");
      expect(spells.elixir).toBeGreaterThan(6);
    }
    await page.screenshot({
      path: info.outputPath(`pulled-survival-${card}.png`),
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
}
