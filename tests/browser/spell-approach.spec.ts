import { expect, test } from "@playwright/test";
import { expectedEffects } from "./native-assets";

for (const card of ["balloon", "hog", "crown-hog"]) {
  test(`${card}: the ordinary AI timer leads the Raged approach`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/tests/fixtures/combat.html?scene=ai-approach-${card}`);
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
    const spell = card === "balloon" ? "rocket" : "fireball";
    expect(accepted.map((a: any) => [a.card, a.tick])).toEqual([[spell, 74]]);
    expect(accepted[0].y).toBeLessThan((card === "balloon" ? 20 : 13) - 2);
    expect(
      (await state()).entities.filter(
        (e: any) => e.card === (card === "balloon" ? "balloon" : "hog-rider"),
      ),
    ).toHaveLength(1);
    await advance();
    await advance();
    await advance();
    expect(await actions()).toEqual(accepted);
    expect(
      (await state()).entities.filter(
        (e: any) => e.card === (card === "balloon" ? "balloon" : "hog-rider"),
      ),
    ).toHaveLength(0);
    expect((await state()).winner).toBeNull();
    await page.screenshot({
      path: info.outputPath(`spell-approach-${card}.png`),
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
}
