import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

for (const scene of ["ai-spells", "ai-spells-mirror"])
  test(`${scene}: the ordinary AI timer casts a cheaper tower finisher and waits for its in-flight damage`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`/tests/fixtures/combat.html?scene=${scene}`);
    await expect(page.locator("#status")).toContainText(
      `${expectedEffects} effects`,
      { timeout: 60000 },
    );
    const output = page.locator("#destruction");
    const state = async () =>
      JSON.parse((await output.getAttribute("data-ai-spells"))!);
    const time = async () =>
      JSON.parse((await output.getAttribute("data-state"))!).time;
    const step = async () => {
      const before = await time();
      await page.locator("#second").click();
      await expect.poll(time).toBeGreaterThan(before + 0.99);
    };
    await expect
      .poll(async () => (await state()).towers.some((t: any) => t.hp === 100))
      .toBe(true);
    const target = (await state()).towers.find((t: any) => t.hp === 100);
    expect(target).toBeDefined();
    await step();
    await step();
    expect((await state()).actions).toEqual([]);
    await step();
    const cast = (await state()).actions;
    expect(cast).toHaveLength(1);
    expect(cast[0]).toMatchObject({
      card: "fireball",
      x: target.x,
      y: target.y,
    });
    if (scene === "ai-spells-mirror") {
      expect((await state()).hand).toContain("mirror");
      expect((await state()).elixir).toBeGreaterThan(2);
      expect((await state()).elixir).toBeLessThan(3);
    }
    await step();
    expect((await state()).actions).toHaveLength(1);
    await page.waitForTimeout(180);
    expect((await state()).actions).toEqual(cast);
    await step();
    await step();
    expect(
      (await state()).towers.find((t: any) => t.id === target.id)?.hp ?? 0,
    ).toBeLessThanOrEqual(0);
    expect((await state()).crowns).toBe(1);
    expect((await state()).actions).toHaveLength(1);
    expect(errors).toEqual([]);
  });

for (const card of ["poison", "zap"] as const)
  test(`the AI wins the launched-shot race with ${card} on its ordinary timer`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`/tests/fixtures/combat.html?scene=ai-launched-${card}`);
    await expect(page.locator("#status")).toContainText(
      `${expectedEffects} effects`,
      { timeout: 60000 },
    );
    const output = page.locator("#destruction");
    const actions = async () =>
      JSON.parse((await output.getAttribute("data-ai-defense"))!).actions;
    const state = async () =>
      JSON.parse((await output.getAttribute("data-ai-areas"))!);
    const time = async () =>
      JSON.parse((await output.getAttribute("data-state"))!).time;
    const original = await actions();
    for (let i = 0; i < 2; i++) {
      const before = await time();
      await page.locator("#second").click();
      await expect.poll(time).toBeGreaterThan(before + 0.99);
    }
    expect(await actions()).toEqual(original);
    await page.locator("#second").click();
    await expect
      .poll(async () => (await actions()).length)
      .toBe(original.length + 1);
    expect((await actions()).at(-1)).toMatchObject({ card, team: "red" });
    if (card === "poison") await page.locator("#second").click();
    await expect.poll(async () => (await state()).winner).toBe("red");
    const won = await state();
    expect(won.kings.find((e: any) => e.team === "red").hp).toBe(100);
    expect(won.kings.find((e: any) => e.team === "blue")?.hp ?? 0).toBe(0);
    await page.screenshot({
      path: info.outputPath(`ai-launched-${card}.png`),
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
