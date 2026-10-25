import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";
import { CARD_MAP } from "../../src/game/cards";

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

test("the ordinary timer holds Zap for an earlier queued overtime win", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/tests/fixtures/combat.html?scene=ai-overtime-reserved");
  await expect(page.locator("#status")).toContainText(
    `${expectedEffects} effects`,
    { timeout: 60000 },
  );
  const output = page.locator("#destruction");
  const state = async () =>
    JSON.parse((await output.getAttribute("data-ai-areas"))!);
  const spells = async () =>
    JSON.parse((await output.getAttribute("data-ai-spells"))!);
  const original = (await spells()).actions;
  expect(original).toHaveLength(1);
  expect(original[0].card).toBe("rocket");
  for (let i = 0; i < 3; i++) await page.locator("#second").click();
  await expect.poll(async () => (await state()).winner).toBe("red");
  expect((await spells()).actions).toEqual(original);
  expect((await spells()).hand).toContain("zap");
  expect((await state()).reason).toBe("Sudden death");
  expect((await state()).time).toBeCloseTo(202.6);
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

for (const scene of ["ai-overtime", "ai-tiebreaker"])
  test(`${scene}: the ordinary timer chooses Zap to win the match`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`/tests/fixtures/combat.html?scene=${scene}`);
    await expect(page.locator("#status")).toContainText(
      `${expectedEffects} effects`,
      { timeout: 60000 },
    );
    const output = page.locator("#destruction");
    const state = async () =>
      JSON.parse((await output.getAttribute("data-ai-areas"))!);
    const spells = async () =>
      JSON.parse((await output.getAttribute("data-ai-spells"))!);
    const time = async () =>
      JSON.parse((await output.getAttribute("data-state"))!).time;
    const princess = (await spells()).towers.find(
      (e: any) => e.hp === (scene === "ai-overtime" ? 50 : 100),
    );
    expect(princess).toBeDefined();
    for (let i = 0; i < 2; i++) {
      const before = await time();
      await page.locator("#second").click();
      await expect.poll(time).toBeGreaterThan(before + 0.99);
    }
    expect((await spells()).actions).toEqual([]);
    await page.locator("#second").click();
    await expect.poll(async () => (await state()).winner).toBe("red");
    expect((await spells()).actions).toHaveLength(1);
    const cast = (await spells()).actions[0];
    expect(cast.card).toBe("zap");
    expect(Math.hypot(cast.x - princess.x, cast.y - princess.y)).toBeLessThan(
      CARD_MAP.zap.radius! + princess.radius,
    );
    expect((await state()).kings.find((e: any) => e.team === "red").hp).toBe(
      scene === "ai-overtime" ? 100 : 80,
    );
    expect(
      (await spells()).towers.find((e: any) => e.id === princess.id)?.hp ?? 0,
    ).toBeCloseTo(scene === "ai-overtime" ? 0 : 23.2);
    if (scene === "ai-overtime") {
      expect((await state()).time).toBeGreaterThan(202.5);
      expect((await state()).time).toBeLessThan(203);
      expect((await state()).reason).toBe("Sudden death");
    } else {
      expect((await state()).time).toBe(300);
      expect((await state()).reason).toBe("Tiebreaker");
    }
    await page.screenshot({
      path: info.outputPath(`${scene}.png`),
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
