import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";
for (const [scenario, label] of [
  ["lane", "weak tower's lane"],
  ["center", "central King approach"],
  ["ground-swarm", "ground swarm instead of the isolated Hog"],
  ["air-swarm", "air swarm instead of the isolated Hog"],
] as const)
  test(`the ordinary AI timer defends the ${label}`, async ({ page }, info) => {
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
    if (scenario === "ground-swarm" || scenario === "air-swarm") {
      const card =
        scenario === "ground-swarm" ? "skeleton-army" : "minion-horde";
      expect(result.targets.filter((e: any) => e.card === card)).toHaveLength(
        scenario === "ground-swarm" ? 15 : 6,
      );
      expect(action.card).toBe(
        scenario === "ground-swarm" ? "valkyrie" : "baby-dragon",
      );
      expect(action.x).toBeGreaterThan(1);
      expect(action.x).toBeLessThan(7);
    } else if (scenario === "lane") {
      expect(["mini-pekka", "knight"]).toContain(action.card);
      expect(result.towers.find((e: any) => e.lane === "right").hp).toBe(100);
      expect(action.x).toBeGreaterThan(13);
      expect(action.x).toBeLessThan(15);
      expect(action.y).toBeCloseTo(9.3);
    } else {
      expect(["mini-pekka", "knight"]).toContain(action.card);
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
    if (info.project.name === "desktop" && scenario === "ground-swarm")
      await page.screenshot({
        path: info.outputPath("ai-ground-swarm-defense.png"),
        animations: "disabled",
      });
    expect(errors).toEqual([]);
  });

for (const blocked of [false, true])
  test(`the ordinary AI timer lures a Balloon${blocked ? " around an occupied center" : ""}`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const scene = `ai-defense-balloon${blocked ? "-blocked" : ""}`;
    await page.goto("/tests/fixtures/combat.html");
    await page.locator("#scenario").selectOption(scene);
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
    await expect.poll(async () => (await state()).scene).toBe(scene);
    await step();
    await step();
    expect((await state()).actions).toEqual([]);
    await step();
    const result = await state();
    expect(result.actions).toHaveLength(1);
    const cannon = result.buildings.find((e: any) => e.card === "cannon");
    expect(result.actions[0]).toMatchObject({
      card: "cannon",
      x: blocked ? 11.5 : 9,
      y: 10,
    });
    expect(result.targets.find((e: any) => e.card === "balloon").target).toBe(
      cannon.id,
    );
    expect(result.elixir).toBeGreaterThanOrEqual(0);
    if (info.project.name === "desktop" && !blocked)
      await page.screenshot({
        path: info.outputPath("ai-balloon-distraction.png"),
        animations: "disabled",
      });
    for (let i = 0; i < 6 && !(await state()).balloonHits.length; i++)
      await step();
    const hit = await state();
    expect(hit.balloonHits[0]).toMatchObject({
      x: cannon.x,
      y: cannon.y,
      value: 640,
    });
    expect(hit.towers.every((e: any) => e.hp === e.maxHp)).toBe(true);
    expect(
      hit.buildings.find((e: any) => e.id === cannon.id).target,
    ).toBeNull();
    expect(errors).toEqual([]);
  });

for (const counter of ["missing", "unaffordable"])
  test(`AI defends a supported lane while its air counter is ${counter}`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const scene = `ai-defense-fallback-${counter}`;
    await page.goto("/tests/fixtures/combat.html");
    await page.locator("#scenario").selectOption(scene);
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
    await expect.poll(async () => (await state()).scene).toBe(scene);
    const before = await state();
    const primary = before.targets.find(
      (e: any) => e.id === before.priority[0],
    );
    expect(primary.card).toBe("minion-horde");
    expect(
      before.targets.filter((e: any) => e.card === "minion-horde"),
    ).toHaveLength(6);
    await step();
    await step();
    expect((await state()).actions).toEqual([]);
    await step();
    const result = await state();
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({
      card: "knight",
      team: "red",
      y: 9.3,
    });
    expect(result.actions[0].x).toBeGreaterThan(13);
    expect(result.actions[0].x).toBeLessThan(15);
    expect(result.elixir).toBeGreaterThanOrEqual(0);
    expect(result.elixir).toBeLessThan(2);
    for (
      let i = 0;
      i < 3 &&
      (await state()).targets.find((e: any) => e.card === "hog-rider").hp ===
        before.targets.find((e: any) => e.card === "hog-rider").hp;
      i++
    )
      await step();
    const defended = await state(),
      hog = defended.targets.find((e: any) => e.card === "hog-rider");
    expect(hog.hp).toBeLessThan(hog.maxHp);
    expect(
      defended.defenders.find((e: any) => e.card === "knight")?.target,
    ).toBe(hog.id);
    expect(
      defended.targets
        .filter((e: any) => e.card === "minion-horde")
        .every((e: any) => e.hp === e.maxHp),
    ).toBe(true);
    if (info.project.name === "desktop")
      await page.screenshot({
        path: info.outputPath(`ai-fallback-${counter}.png`),
        animations: "disabled",
      });
    expect(errors).toEqual([]);
  });
