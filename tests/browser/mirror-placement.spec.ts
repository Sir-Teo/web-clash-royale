import { test, expect } from "@playwright/test";
import { STARTER_DECK } from "../../src/game/cards";
import { expectedCards, expectedAnimations } from "./native-assets";

test.use({ serviceWorkers: "block" });
for (const card of ["log", "miner"] as const)
  test(`Mirror repeats ${card} placement rules and shows the matching battle hint`, async ({
    page,
  }, info) => {
    test.setTimeout(120000);
    const name = card === "log" ? "The Log" : "Miner";
    const hint =
      card === "log" ? "Deploy on your side" : "Deploy on either half";
    const deck = ["mirror", card, ...STARTER_DECK.slice(0, 6)];
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript((deck) => {
      localStorage.setItem(
        "browser-royale.profile.v1",
        JSON.stringify({
          version: 1,
          name: "Placement Student",
          sound: false,
          music: false,
          seenTutorial: true,
          deck,
        }),
      );
    }, deck);
    await page.goto("/");
    const state = () => page.evaluate(() => (window as any).__arena?.state);
    await expect
      .poll(async () => (await state())?.loadedCards, { timeout: 60000 })
      .toBe(expectedCards);
    await expect
      .poll(async () => (await state()).loadedAnimations, { timeout: 60000 })
      .toBe(expectedAnimations);
    await page.evaluate(() => {
      Math.random = () => (48 - 1) / 2147483646;
    });
    await page.locator(".mode-select").click();
    await page.locator('[data-mode="training"]').click();
    await page.locator("#battle-button").click();
    await expect
      .poll(async () => (await state()).intro.blocking, { timeout: 15000 })
      .toBe(false);
    const hand = (await state()).hand;
    expect(hand).toContain(card);
    expect(hand).toContain("mirror");
    const tap = async (x: number, y: number) => {
      const point = await page.evaluate(
        ({ x, y }) => (window as any).__arena.project(x, y),
        { x, y },
      );
      if (info.project.name === "desktop")
        await page.mouse.click(point.x, point.y);
      else await page.touchscreen.tap(point.x, point.y);
    };
    const original = page.locator(`#hand [data-native-card="${card}"]`);
    const mirror = page.locator('#hand [data-native-card="mirror"]');
    await expect(mirror).toBeDisabled();
    const rendered = (await state()).renderedFrames;
    if (info.project.name === "desktop") await original.click();
    else await original.tap();
    await expect(page.locator("#hand-caption")).toContainText(
      `${name} · ${card === "log" ? 2 : 3} elixir · ${hint}`,
    );
    await expect(page.locator("#deploy-hint")).toHaveText(`${name} · ${hint}`);
    expect((await state()).placement).toMatchObject({
      blockedUntil: card === "log" ? [17.5, 17.5] : [0, 0],
      riverBlocked: card === "miner",
    });
    await expect
      .poll(async () => (await state()).renderedFrames)
      .toBeGreaterThan(rendered + 1);
    await page.screenshot({
      path: info.outputPath(`${card}-placement-territory.png`),
      animations: "disabled",
    });
    await tap(4, card === "log" ? 22 : 8);
    await expect(original).toHaveCount(0);
    await expect(mirror).toHaveAttribute("data-mirror-card", card);
    await expect(mirror).not.toHaveClass(/unaffordable/, { timeout: 30000 });
    if (info.project.name === "desktop") await mirror.click();
    else await mirror.tap();
    await expect(page.locator("#hand-caption")).toContainText(
      `Mirror → ${name} · ${card === "log" ? 3 : 4} elixir · ${hint}`,
    );
    await expect(page.locator("#deploy-hint")).toHaveText(`${name} · ${hint}`);
    expect((await state()).placement).toMatchObject({
      card,
      blockedUntil: card === "log" ? [17.5, 17.5] : [0, 0],
      riverBlocked: card === "miner",
      point: null,
    });
    if (card === "log") {
      await tap(6, 8);
      expect((await state()).placement).toMatchObject({
        valid: false,
        reason: "Deploy The Log on your side of the arena.",
      });
      await expect(page.locator(".placement-feedback")).toBeVisible();
      await expect(page.locator(".placement-feedback")).toContainText(
        "Deploy The Log on your side of the arena.",
      );
      await expect(mirror).toHaveAttribute("aria-pressed", "true");
    }
    await tap(6, card === "log" ? 22 : 8);
    await expect(mirror).toHaveCount(0);
    await page
      .getByRole("button", { name: "Pause battle", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Leave battle", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("browser-royale.profile.v1")!)
              .history.length,
        ),
      )
      .toBe(1);
    const actions = await page.evaluate(() =>
      JSON.parse(
        localStorage.getItem("browser-royale.profile.v1")!,
      ).history[0].replay.actions.filter((a: any) => a.team === "blue"),
    );
    expect(actions).toHaveLength(2);
    expect(actions.map((action: any) => action.card)).toEqual([card, "mirror"]);
    for (const [index, action] of actions.entries()) {
      // Screen-to-arena projection and touch coordinates have finite precision.
      const tolerance = info.project.name === "desktop" ? 0.0001 : 0.15;
      expect(Math.abs(action.x - (index === 0 ? 4 : 6))).toBeLessThan(
        tolerance,
      );
      expect(Math.abs(action.y - (card === "log" ? 22 : 8))).toBeLessThan(
        tolerance,
      );
    }
    expect(errors).toEqual([]);
  });
