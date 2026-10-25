import { expect, test } from "@playwright/test";
import { expectedEffects } from "./native-assets";

for (const card of ["fireball", "rocket"]) {
  test(`${card}: the ordinary AI timer leads the native Tornado pull`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/tests/fixtures/combat.html?scene=ai-pulled-aim-${card}`);
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
    const accepted = await actions();
    expect(accepted.map((a: any) => [a.card, a.tick])).toEqual([
      ["tornado", 73],
      [card, 74],
    ]);
    expect(accepted[1].x).toBeGreaterThan(8);
    const beforeHit = (await state()).entities.filter(
      (e: any) => e.card === "wizard",
    );
    expect(beforeHit).toHaveLength(3);
    expect(beforeHit.every((e: any) => e.hp === 453)).toBe(true);
    await advance();
    await advance();
    await advance();
    expect(await actions()).toEqual(accepted);
    expect(
      (await state()).entities.filter((e: any) => e.card === "wizard"),
    ).toHaveLength(0);
    expect((await state()).winner).toBeNull();
    await page.screenshot({
      path: info.outputPath(`pulled-aim-${card}.png`),
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
}
