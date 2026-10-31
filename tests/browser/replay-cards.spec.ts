import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import type { Replay } from "../../src/game/engine";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const state = (page: Page) =>
  page.evaluate(() => (window as any).__arena?.state);
let replay: Replay;
let names: Record<string, string>;
test.beforeAll(async ({}, info) => {
  const file = info.outputPath("replay-card-rules.mjs");
  await build({
    stdin: {
      contents:
        'export { Battle } from "./src/game/engine.ts"; export { PRESETS, CARD_MAP } from "./src/game/cards.ts";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: file,
  });
  const rules = await import(pathToFileURL(file).href);
  names = Object.fromEntries(
    Object.values(rules.CARD_MAP).map((c: any) => [c.id, c.name]),
  );
  const deck = [...rules.PRESETS[0].deck];
  deck[0] = "mirror";
  for (let seed = 1; seed <= 100; seed++) {
    const battle = new rules.Battle({ seed, ai: false, deck, enemyDeck: deck });
    if (
      !["blue", "red"].every((team) =>
        battle.players[team].hand.includes("mirror"),
      )
    )
      continue;
    while (battle.tick < 600) battle.step();
    replay = battle.exportReplay();
    break;
  }
  expect(replay).toBeDefined();
});

for (const perspective of ["blue", "red"] as const)
  test(`${perspective} replay cards retain playback, focus and saved progress during inspection`, async ({
    page,
  }, info) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(
      ({ key, replay, perspective }) => {
        localStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            name: "Card Student",
            sound: false,
            music: false,
            seenTutorial: true,
            history: [
              {
                id: 17,
                date: "2026-10-31T12:00:00.000Z",
                opponent: "Mirror Captain",
                opponentType: "friend",
                mode: replay.mode,
                winner: "red",
                crowns: [0, 0],
                replay: { ...replay, perspective },
              },
            ],
          }),
        );
      },
      { key, replay, perspective },
    );
    if (info.project.name !== "desktop")
      await page.setViewportSize({ width: 320, height: 740 });
    await page.goto("/");
    await expect
      .poll(async () => (await state(page))?.loadedCards, { timeout: 60000 })
      .toBe(expectedCards);
    const saved = await page.evaluate((key) => localStorage.getItem(key), key);
    await page.getByRole("button", { name: "Battle log", exact: true }).click();
    await page.locator("[data-replay]").click();
    await page
      .getByRole("button", { name: "Pause replay", exact: true })
      .click();
    await page.locator("#replay-seek").fill("0");
    await page.locator("#replay-speed").click();
    await expect(page.locator("#hand-caption")).toHaveText(
      "Tap a hand card or press 1–4 to inspect",
    );
    expect(
      await page
        .locator("#hand-caption")
        .evaluate((e) => parseFloat(getComputedStyle(e).fontSize)),
    ).toBeGreaterThanOrEqual(11);
    const mirror = page.locator('#hand [data-native-card="mirror"]');
    await expect(mirror).toBeEnabled();
    await expect(mirror).toHaveAttribute(
      "aria-label",
      "Inspect Mirror, unknown elixir",
    );
    expect(await mirror.getAttribute("aria-pressed")).toBeNull();
    const initial = await state(page);
    await mirror.focus();
    await mirror.press(perspective === "blue" ? "Enter" : "Space");
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.locator("#modal-title")).toHaveText("Mirror");
    await expect(page.locator(".level-pill")).toHaveText(
      "CURRENT ARENA STATS · LEVEL 11",
    );
    await expect(page.locator("#card-edit-deck")).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath("replay-card-stats.png"),
      animations: "disabled",
    });
    await page.waitForTimeout(150);
    expect(await state(page)).toMatchObject({
      time: initial.time,
      hand: initial.hand,
      elixir: initial.elixir,
      actions: 0,
      paused: true,
      selected: -1,
    });
    await page
      .getByRole("button", { name: "Back to replay", exact: true })
      .click();
    await expect(mirror).toBeFocused();
    expect((await state(page)).paused).toBe(true);

    const canvas = page.locator("#arena-canvas canvas");
    const shortcut = String(initial.hand.indexOf("mirror") + 1);
    await expect(mirror).toHaveAttribute("aria-keyshortcuts", shortcut);
    await expect(canvas).toHaveAttribute(
      "aria-keyshortcuts",
      "1 2 3 4 ArrowLeft ArrowRight Home End [ ] Space",
    );
    await canvas.focus();
    await page.keyboard.down(shortcut);
    await expect(page.locator("#modal-title")).toHaveText("Mirror");
    await page.keyboard.down(shortcut);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // A held shortcut cannot reopen the card after its dialog closes.
    await page.keyboard.down(shortcut);
    await page.keyboard.up(shortcut);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(mirror).toBeFocused();
    await page.locator("#replay-seek").focus();
    await page.keyboard.press(shortcut);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.locator("#replay-seek").fill("0");

    // Inspect the hand at the latest requested position before a seek frame runs.
    await page.evaluate(() => {
      const slider = document.querySelector<HTMLInputElement>("#replay-seek")!;
      slider.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, pointerId: 71 }),
      );
      slider.value = "40";
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector<HTMLButtonElement>("#hand > button")!.click();
      window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 71 }));
    });
    await expect(page.getByRole("dialog")).toBeVisible();
    expect((await state(page)).time).toBe(8);
    await page.keyboard.press("Escape");
    await expect(page.locator("#hand > button").first()).toBeFocused();
    await page.locator("#replay-seek").fill("0");

    // The opposite hand remains inspectable without changing the viewing side.
    await page.locator("#replay-side").click();
    const card = page.locator("#hand > button").first();
    const id = (await state(page)).hand[0];
    if (info.project.name === "desktop") await card.click();
    else await card.tap();
    await expect(page.locator("#modal-title")).toHaveText(names[id]);
    await page.keyboard.press("Escape");
    await expect(card).toBeFocused();
    await expect(page.locator("#replay-side")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator("#replay-speed")).toHaveText("2×");
    expect((await state(page)).paused).toBe(true);

    // Inspecting a running replay freezes time, then resumes at the same speed.
    await page
      .getByRole("button", { name: "Resume replay", exact: true })
      .click();
    await expect.poll(async () => (await state(page)).time).toBeGreaterThan(0);
    if (perspective === "red") {
      await canvas.focus();
      await page.keyboard.press("1");
    } else await card.click();
    const during = await state(page);
    await page.waitForTimeout(200);
    expect((await state(page)).time).toBe(during.time);
    expect(during.paused).toBe(true);
    await page.locator(".close-modal").click();
    await expect
      .poll(async () => (await state(page)).time)
      .toBeGreaterThan(during.time);
    expect((await state(page)).paused).toBe(false);
    await expect(page.locator("#replay-speed")).toHaveText("2×");

    // Completed playback stays stopped when its last hand is inspected.
    await page.locator("#replay-seek").fill("100");
    await expect(
      page.getByRole("button", { name: "Restart replay", exact: true }),
    ).toBeVisible();
    const completed = await state(page);
    await card.click();
    await page
      .getByRole("button", { name: "Back to replay", exact: true })
      .click();
    expect(await state(page)).toMatchObject({
      paused: true,
      time: completed.time,
      winner: completed.winner,
      actions: 0,
    });
    await expect(card).toBeFocused();
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
      saved,
    );
    expect(errors).toEqual([]);
    await page.screenshot({
      path: info.outputPath("replay-inspectable-hand.png"),
      animations: "disabled",
    });
  });
