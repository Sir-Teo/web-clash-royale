import { test, expect as baseExpect, type Page } from "@playwright/test";
import { CARD_MAP } from "../../src/game/cards";
const expect = baseExpect.configure({ timeout: 15000 });
const state = (p: Page) =>
  p.evaluate(() => (window as any).__arena?.state ?? {});
async function init(p: Page, name: string) {
  await p.addInitScript((name) => {
    if (!localStorage.getItem("browser-royale.profile.v1"))
      localStorage.setItem(
        "browser-royale.profile.v1",
        JSON.stringify({
          version: 1,
          name,
          sound: false,
          music: false,
          seenTutorial: true,
        }),
      );
  }, name);
  await p.goto("/");
  await expect(p.locator("#friend-button")).toBeVisible();
}
async function deploy(p: Page, x = 4, y = 22) {
  await expect.poll(async () => (await state(p)).intro.blocking).toBe(false);
  const s = await state(p);
  const slot = s.hand.findIndex(
    (id: keyof typeof CARD_MAP) =>
      CARD_MAP[id].cost <= s.elixir && CARD_MAP[id].kind === "troop",
  );
  expect(slot).toBeGreaterThanOrEqual(0);
  const card = p.locator(`[data-slot="${slot}"]`);
  const box = await card.boundingBox();
  const touch = await p.evaluate(() => navigator.maxTouchPoints > 0);
  if (touch)
    await p.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);
  else await card.click();
  const point = await p.evaluate(
    ({ x, y }) => (window as any).__arena.project(x, y),
    { x, y },
  );
  if (touch) await p.touchscreen.tap(point.x, point.y);
  else await p.mouse.click(point.x, point.y);
  await expect
    .poll(async () => (await state(p)).actions)
    .toBeGreaterThan(s.actions);
}
test("two players join, deploy from opposite sides, reconnect and replay the same battle", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(240000);
  const context = await browser.newContext({
    ...info.project.use,
    baseURL: "http://127.0.0.1:5188",
  } as any);
  const red = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  red.on("pageerror", (e) => errors.push(e.message));
  try {
    console.log("Multiplayer: opening both players");
    await init(page, "Blue King");
    await init(red, "Red Queen");
    await page.getByRole("button", { name: "Play with a friend" }).click();
    await page
      .getByRole("button", { name: "Create a room", exact: true })
      .click();
    await expect(page.locator(".room-code")).toHaveText(/^[A-Z2-9]{6}$/);
    const code = (await page.locator(".room-code").textContent())!;
    await red.goto(`/?room=${code}`);
    await expect(red.getByLabel("ROOM CODE", { exact: true })).toHaveValue(
      code,
    );
    await red.getByRole("button", { name: "Join room", exact: true }).click();
    await expect(page.locator(".room-player.red")).toContainText("Red Queen");
    await expect(red.locator(".room-player.blue")).toContainText("Blue King");
    await expect
      .poll(
        async () => (await page.locator("#room-ready").boundingBox())!.height,
      )
      .toBeGreaterThanOrEqual(44);
    await page.screenshot({
      animations: "disabled",
      path: `docs/screenshots/${info.project.name}-friendly-room.png`,
    });
    await page
      .getByRole("button", { name: "Ready for battle", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Cancel ready" }),
    ).toBeVisible();
    await red
      .getByRole("button", { name: "Ready for battle", exact: true })
      .click();
    await expect
      .poll(async () => (await state(page)).multiplayer?.phase)
      .toBe("playing");
    await expect
      .poll(async () => (await state(red)).multiplayer?.team)
      .toBe("red");
    await expect(page.locator(".competitor.enemy b")).toHaveText("Red Queen");
    await expect(red.locator(".competitor.enemy b")).toHaveText("Blue King");
    console.log("Multiplayer: both players in battle");
    await deploy(page);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const background = await state(page);
    await deploy(red, 14, 22);
    const whileHidden = await state(page);
    expect(whileHidden.paused).toBe(false);
    expect(whileHidden.renderedFrames).toBe(background.renderedFrames);
    expect(whileHidden.time).toBeGreaterThan(background.time);
    await page.evaluate(() => {
      delete (document as any).hidden;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(async () => (await state(page)).actions).toBe(2);
    await expect.poll(async () => (await state(red)).actions).toBe(2);
    const a = await state(page),
      b = await state(red);
    for (const e of a.units.filter((e: any) => e.card === "tower")) {
      const other = b.units.find((x: any) => x.id === e.id);
      expect(other.x).toBeCloseTo(18 - e.x);
      expect(other.y).toBeCloseTo(32 - e.y);
      expect(other.team).not.toBe(e.team);
    }
    await red.getByRole("button", { name: "Battle options" }).click();
    const beforeMenu = (await state(red)).time;
    await expect
      .poll(async () => (await state(red)).time)
      .toBeGreaterThan(beforeMenu + 0.4);
    expect((await state(red)).paused).toBe(false);
    await red.getByRole("button", { name: "Back to battle" }).click();
    console.log("Multiplayer: deployed from both sides; reloading red");
    const reloadStart = Date.now();
    await red.reload();
    await expect(
      red.getByRole("button", { name: "Battle options" }),
    ).toBeVisible({ timeout: 90000 });
    await expect
      .poll(async () => (await state(red)).multiplayer?.team)
      .toBe("red");
    await expect.poll(async () => (await state(red)).actions).toBe(2);
    const restored = await state(red);
    console.log("Multiplayer: restored", {
      seconds: (Date.now() - reloadStart) / 1000,
      time: restored.time,
      winner: restored.winner,
      reason: restored.reason,
      connection: restored.multiplayer,
    });
    expect(restored.winner, restored.reason).toBeNull();
    await expect
      .poll(async () => (await state(red)).time)
      .toBeGreaterThan(beforeMenu);
    await expect
      .poll(async () => (await state(red)).nativeTowerPrincesses, {
        timeout: 30000,
      })
      .toBe(4);
    await expect.poll(async () => (await state(red)).loadedCards).toBe(24);
    await expect.poll(async () => (await state(red)).loadedHud).toBe(6);
    expect((await state(red)).intro.active).toBe(false);
    const heading = await red.locator(".arena-heading").boundingBox();
    expect(heading!.y).toBeGreaterThanOrEqual(0);
    await red.screenshot({
      animations: "disabled",
      path: `docs/screenshots/${info.project.name}-friendly-battle.png`,
    });
    await red.getByRole("button", { name: "Battle options" }).click();
    await red.getByRole("button", { name: "Surrender", exact: true }).click();
    await expect.poll(async () => (await state(page)).winner).toBe("blue");
    await expect.poll(async () => (await state(red)).winner).toBe("red");
    await expect(
      red.getByRole("button", { name: "Watch replay", exact: true }),
    ).toBeVisible();
    await red
      .getByRole("button", { name: "Watch replay", exact: true })
      .click();
    const slider = red.getByRole("slider", { name: "Replay timeline" });
    await slider.focus();
    await slider.press("End");
    await expect.poll(async () => (await state(red)).winner).toBe("red");
    const replayProfile = await red.evaluate(() =>
      JSON.parse(localStorage.getItem("browser-royale.profile.v1")!),
    );
    expect(replayProfile.history[0].replay.perspective).toBe("red");
    expect(replayProfile.history[0].opponent).toBe("Blue King");
    expect(replayProfile.history[0].replay.actions).toHaveLength(2);
    expect(replayProfile.trophies).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await context.close().catch(() => {});
  }
});
