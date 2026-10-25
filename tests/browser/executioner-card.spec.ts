import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

test("Executioner axe hits ground and air on its outbound and return paths", async ({ page }, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("executioner");
  await expect(page.locator("#status")).toContainText(`${expectedEffects} effects`, { timeout: 60000 });
  await page.locator("#arena canvas").evaluate((canvas) => {
    canvas.addEventListener("webglcontextlost", () => { canvas.dataset.contextLost = "true"; });
  });
  const data = async () => JSON.parse((await page.locator("#destruction").getAttribute("data-executioner"))!);
  const time = async () => JSON.parse((await page.locator("#destruction").getAttribute("data-state"))!).time;
  const advance = async () => {
    const before = await time();
    await page.locator("#step").click();
    try {
      await expect.poll(time, { timeout: 15000 }).toBeGreaterThan(before + 0.099);
    } catch (error) {
      const lost = await page.locator("#arena canvas").getAttribute("data-context-lost");
      throw new Error(`Executioner scene stopped advancing (WebGL context lost: ${lost === "true"}; page errors: ${errors.join("; ") || "none"})`, { cause: error });
    }
  };
  for (let i = 0; i < 35 && !(await data()).shots.length; i++) await advance();
  expect((await data()).shots).toHaveLength(1);
  expect((await data()).shots[0].returning).toBe(false);
  expect((await data()).visuals[0].sprites.some((sprite: any) => sprite.name === "executioner_projectile")).toBe(true);
  await page.screenshot({ path: info.outputPath("executioner-outbound.png"), fullPage: true });
  for (let i = 0; i < 20 && !(await data()).shots[0]?.returning; i++) await advance();
  expect((await data()).shots[0]?.returning).toBe(true);
  await page.screenshot({ path: info.outputPath("executioner-returning.png"), fullPage: true });
  for (let i = 0; i < 20 && (await data()).shots.length; i++) await advance();
  expect((await data()).shots).toHaveLength(0);
  expect((await data()).hits).toBe(4);
  expect((await data()).enemies.filter((e: any) => e.x === 4).map((e: any) => e.hp)).toEqual([9678, 9678]);
  expect((await data()).enemies.filter((e: any) => e.x === 14).every((e: any) => e.hp === 10000)).toBe(true);
  await page.screenshot({ path: info.outputPath("executioner-after-return.png"), fullPage: true });
  expect(errors).toEqual([]);
});
