import { test, expect } from "@playwright/test";
import { expectedBuildings, expectedEffects } from "./native-assets";

for (const scenario of [
  "normal",
  "rage",
  "king",
  "mirror",
  "stun",
  "legal",
  "rage-area",
  "freeze-area",
])
  test(`AI Miner defense ${scenario} follows the tunnel into a real Hog interception`, async ({
    page,
  }, info) => {
    test.setTimeout(150000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(
      `/tests/fixtures/combat.html?scene=ai-miner-defense-${scenario}`,
    );
    await expect(page.locator("#status")).toContainText(
      `${expectedEffects} effects`,
      { timeout: 60000 },
    );
    await expect(page.locator("#status")).toContainText(
      `${expectedBuildings} buildings loaded`,
    );
    const state = async () =>
      JSON.parse(
        (await page.locator("#destruction").getAttribute("data-ai-defense"))!,
      );
    const miner = async () =>
      JSON.parse(
        (await page.locator("#destruction").getAttribute("data-miner"))!,
      );
    const advance = async () => {
      const before = (await state()).time;
      await page.locator("#second").click();
      await expect
        .poll(async () => (await state()).time)
        .toBeGreaterThan(before + 0.99);
    };
    const initial = await state(),
      hog = initial.targets.find((e: any) => e.card === "hog-rider");
    expect(hog).toBeDefined();
    await advance();
    await advance();
    expect((await state()).actions).toEqual([]);
    await advance();
    for (let i = 0; i < 5 && !(await state()).actions.length; i++)
      await advance();
    const placed = await state();
    expect(placed.actions).toHaveLength(1);
    expect(placed.actions[0].card).toBe(
      scenario === "mirror" ? "mirror" : "miner",
    );
    expect(placed.actions[0].y).toBeLessThan(14.5);
    if (scenario === "legal")
      expect(placed.actions[0]).toMatchObject({ tick: 134, x: 14.5, y: 8.9 });
    await expect
      .poll(miner)
      .toMatchObject({ traveling: 1, units: 0, arrivals: 0 });
    await expect.poll(async () => (await miner()).trails).toHaveLength(1);
    if (scenario === "normal")
      await page.screenshot({
        path: info.outputPath("miner-defense-tunnel.png"),
        fullPage: true,
      });
    for (let i = 0; i < 10 && !(await state()).minerHits.length; i++)
      await advance();
    const hit = await state();
    expect(hit.minerHits[0]).toMatchObject({ team: "red", value: 194 });
    expect(await miner()).toMatchObject({
      traveling: 0,
      units: 1,
      arrivals: 1,
      trails: [],
    });
    await expect
      .poll(async () =>
        (await state()).defenders.some(
          (e: any) => e.card === "miner" && e.native && e.target === hog.id,
        ),
      )
      .toBe(true);
    expect(hit.targets.find((e: any) => e.id === hog.id).hp).toBeLessThan(
      hog.hp,
    );
    if (scenario !== "legal")
      expect(
        hit.towers
          .filter((e: any) => e.hp > 0)
          .every((e: any) => e.hp === e.maxHp),
      ).toBe(true);
    expect(hit.actions).toEqual(placed.actions);
    if (["normal", "rage", "king", "freeze-area"].includes(scenario))
      await page.screenshot({
        path: info.outputPath(`miner-defense-${scenario}-hit.png`),
        fullPage: true,
      });
    expect(
      await page.evaluate(() => document.body.scrollWidth <= innerWidth),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
