import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

for (const card of ["inferno-tower", "inferno-dragon"] as const)
  test(`${card} renders buff-adjusted clock stages on both teams`, async ({
    page,
  }, info) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/tests/fixtures/combat.html");
    await page.locator("#scenario").selectOption("inferno-clock");
    await page.locator("#attack-card").selectOption(card);
    await expect(page.locator("#status")).toContainText(
      `${expectedEffects} effects`,
      { timeout: 60000 },
    );
    const state = async () =>
      JSON.parse(
        (await page
          .locator("#destruction")
          .getAttribute("data-inferno-clock"))!,
      ) as {
        version: number;
        time: number;
        bodies: {
          id: number;
          card: string;
          team: string;
          mode: string;
          lock: { elapsed: number; stage: number };
        }[];
      };
    const beams = async () =>
      JSON.parse(
        (await page
          .locator("#destruction")
          .getAttribute("data-inferno-beams"))!,
      ) as {
        id: number;
        stage: number;
        beam: string;
      }[];
    const rates: Record<string, number> = {
      normal: 1,
      rage: 1.34,
      slow: 0.64,
      both: 0.86,
    };
    const clips =
      card === "inferno-tower"
        ? ["inferno_beam", "inferno_beam_stage2", "inferno_beam_stage3"]
        : [
            "inferno_dragon_beam",
            "inferno_dragon_beam1",
            "inferno_dragon_beam2",
          ];
    const check = async (seconds: number) => {
      const current = await state(),
        visual = await beams();
      expect(current.version).toBe(25);
      expect(current.time).toBe(seconds);
      expect(current.bodies).toHaveLength(8);
      expect(visual).toHaveLength(8);
      expect(new Set(current.bodies.map((body) => body.team)).size).toBe(2);
      for (const body of current.bodies) {
        const elapsed = seconds * rates[body.mode];
        const stage = elapsed >= 4 ? 2 : elapsed >= 2 ? 1 : 0;
        expect(body.lock.elapsed).toBeCloseTo(elapsed, 8);
        expect(body.lock.stage).toBe(stage);
        expect(visual.find((beam) => beam.id === body.id)).toMatchObject({
          stage,
          beam: clips[stage],
        });
      }
    };
    for (let second = 1; second <= 7; second++) {
      await page.locator("#second").click();
      await expect
        .poll(async () => (await state()).time, { timeout: 30000 })
        .toBe(second);
      await check(second);
      if (second === 2 || second === 4) {
        await page
          .locator("main")
          .screenshot({
            path: info.outputPath(`${card}-buffed-${second}s.png`),
          });
        const held = { state: await state(), beams: await beams() };
        await page.waitForTimeout(150);
        expect({ state: await state(), beams: await beams() }).toEqual(held);
      }
      if (second === 4) {
        await page.locator("#rebuild").click();
        await expect
          .poll(async () => (await beams()).length, { timeout: 30000 })
          .toBe(8);
        await check(second);
      }
    }
    expect(errors).toEqual([]);
  });
