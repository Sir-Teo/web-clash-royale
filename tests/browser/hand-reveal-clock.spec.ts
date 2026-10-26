import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import source from "../../public/assets/ui/cards/cards.json" with { type: "json" };

for (const reduced of [false, true])
  test(`hand reveal follows simulation frames and pause${reduced ? " with reduced motion" : ""}`, async ({
    page,
  }, info) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.emulateMedia({
      reducedMotion: reduced ? "reduce" : "no-preference",
    });
    await page.clock.install({ time: new Date("2026-10-26T12:00:00Z") });
    await page.addInitScript(() => {
      localStorage.setItem(
        "browser-royale.profile.v1",
        JSON.stringify({
          version: 1,
          seenTutorial: true,
          sound: false,
          music: false,
          deck: [
            "skeletons",
            "ice-spirit",
            "goblins",
            "spear-goblins",
            "archers",
            "knight",
            "bats",
            "fire-spirits",
          ],
        }),
      );
      Math.random = () => 0;
    });
    await page.goto("/");
    await page.locator("#battle-button").click();
    const state = () => page.evaluate(() => (window as any).__arena.state);
    await expect
      .poll(async () => (await state()).intro.blocking, { timeout: 60000 })
      .toBe(false);
    await expect(page.locator("#hand .native-card-ready")).toHaveCount(4, {
      timeout: 60000,
    });
    const now = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(new Date(now + 1000));
    const slot = (await state()).hand.indexOf("skeletons");
    expect(slot).toBeGreaterThanOrEqual(0);
    await page.keyboard.press(String(slot + 1));
    await page.keyboard.press("Enter");
    const card = page.locator(`#hand [data-slot="${slot}"]`);
    await expect(card).not.toHaveAttribute("data-native-card", "skeletons");
    const start = (await state()).time;
    let motionReduced = reduced;
    const frames: { time: number; frame: number; clip: string | null }[] = [];
    const check = async () => {
      const elapsed = (await state()).time - start;
      const expected = Math.floor(elapsed * source.clips.reveal.fps + 1e-6);
      const revealing =
        !motionReduced && expected <= source.clips.reveal.labels.show_end;
      const frame = Number(await card.getAttribute("data-card-frame"));
      const clip = await card.getAttribute("data-card-clip");
      expect(clip).toBe(revealing ? "reveal" : "hand");
      expect(frame).toBe(revealing ? expected : 0);
      frames.push({ time: elapsed, frame, clip });
    };
    await check();
    // Two 16-ms RAF callbacks can still be short of one 33-ms simulation step.
    await page.clock.runFor(50);
    await check();
    expect(frames.at(-1)!.time).toBeGreaterThan(0);
    motionReduced = !reduced;
    await page.emulateMedia({
      reducedMotion: motionReduced ? "reduce" : "no-preference",
    });
    await page.clock.runFor(16);
    await check();
    motionReduced = reduced;
    await page.emulateMedia({
      reducedMotion: reduced ? "reduce" : "no-preference",
    });
    await page.clock.runFor(16);
    await check();
    await page.keyboard.press(String(slot + 1));
    await expect(card).toHaveAttribute("data-card-clip", "hand-selected");
    await page.clock.runFor(35);
    await expect(card).toHaveAttribute("data-card-clip", "hand-selected");
    await page.keyboard.press("Escape");
    await check();
    const heldSvg = await card
      .locator(".native-card-art > svg")
      .elementHandle();
    await page.keyboard.press("Space");
    expect((await state()).paused).toBe(true);
    const held = {
      time: (await state()).time,
      clip: await card.getAttribute("data-card-clip"),
      frame: await card.getAttribute("data-card-frame"),
    };
    expect(
      await card
        .locator(".native-card-art > svg")
        .evaluate((svg, original) => svg === original, heldSvg),
    ).toBe(true);
    await page.clock.runFor(500);
    expect({
      time: (await state()).time,
      clip: await card.getAttribute("data-card-clip"),
      frame: await card.getAttribute("data-card-frame"),
    }).toEqual(held);
    expect(
      await card
        .locator(".native-card-art > svg")
        .evaluate((svg, original) => svg === original, heldSvg),
    ).toBe(true);
    await page.keyboard.press("Escape");
    expect((await state()).paused).toBe(false);
    for (let i = 0; i < 12; i++) {
      await page.clock.runFor(35);
      await check();
    }
    await expect(card).toHaveAttribute("data-card-clip", "hand");
    if (!reduced)
      expect(
        frames.some(
          (frame) =>
            frame.frame > 0 &&
            frame.frame < source.clips.reveal.labels.show_end,
        ),
      ).toBe(true);
    const capture = info.outputPath("reveal-frames.json");
    await writeFile(capture, JSON.stringify(frames, null, 2) + "\n");
    await info.attach("reveal-frames.json", {
      path: capture,
      contentType: "application/json",
    });
    await page.clock.resume();
    expect(errors).toEqual([]);
  });
