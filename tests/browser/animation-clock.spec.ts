import { test, expect } from "@playwright/test";
import knight from "../../public/assets/animations/knight.json" with { type: "json" };
import minion from "../../public/assets/animations/mega-minion.json" with { type: "json" };
import { expectedEffects } from "./native-assets";

type Body = {
  id: number;
  card: "knight" | "mega-minion";
  team: "blue" | "red";
  mode: "normal" | "rage" | "slow" | "both";
  clock?: number;
  frame: number;
  height: number;
  native: boolean;
};
const rates = { normal: 1, rage: 1.35, slow: 0.65, both: 1.35 * 0.65 };
test("Rage and slow drive native troop loop frames and air bob through pause and rebuild", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html?scene=animation-clock");
  await expect(page.locator("#status")).toContainText(
    `${expectedEffects} effects`,
    { timeout: 60000 },
  );
  const state = async () =>
    JSON.parse(
      (await page
        .locator("#destruction")
        .getAttribute("data-animation-clock"))!,
    ) as { time: number; bodies: Body[] };
  await expect
    .poll(
      async () => (await state()).bodies.filter((body) => body.native).length,
    )
    .toBe(16);
  const check = (
    current: Awaited<ReturnType<typeof state>>,
    buffedTime: number,
  ) => {
    expect(current.bodies).toHaveLength(16);
    for (const body of current.bodies) {
      const clock = current.time + buffedTime * (rates[body.mode] - 1);
      if (body.mode === "normal") expect(body.clock).toBeUndefined();
      else expect(body.clock).toBeCloseTo(clock, 8);
      const source = body.card === "knight" ? knight : minion;
      const clips = source.clips as Record<
        string,
        { fps: number; frames: number[] }
      >;
      const clip = clips[`${body.team}-idle-${body.team === "blue" ? 1 : 9}`];
      const index =
        Math.floor((clock + body.id * 0.13) * clip.fps + 1e-6) %
        clip.frames.length;
      expect(body.frame).toBe(clip.frames[index]);
      if (body.card === "mega-minion")
        expect(body.height).toBeCloseTo(
          1.5 + Math.sin(clock * 4 + body.id) * 0.12,
          8,
        );
    }
  };
  await page.locator("#second").click();
  await expect.poll(async () => (await state()).time).toBe(1);
  check(await state(), 1);
  const paused = await state();
  await page.waitForTimeout(180);
  expect(await state()).toEqual(paused);
  await page.locator("#rebuild").click();
  await expect
    .poll(
      async () => (await state()).bodies.filter((body) => body.native).length,
    )
    .toBe(16);
  check(await state(), 1);
  await page.locator("#second").click();
  await expect.poll(async () => (await state()).time).toBe(2);
  check(await state(), 2);
  await page.screenshot({
    path: info.outputPath("buffed-native-loops.png"),
    fullPage: true,
  });
  await page.locator("#clock-clear").click();
  await page.locator("#second").click();
  await expect.poll(async () => (await state()).time).toBe(3);
  check(await state(), 2);
  expect(errors).toEqual([]);
});
