import { test, expect, type Page } from "@playwright/test";
import { CARDS } from "../../src/game/cards";
import sharp from "sharp";

const deck = [
  "skeletons",
  "ice-spirit",
  "goblins",
  "spear-goblins",
  "archers",
  "knight",
  "bats",
  "fire-spirits",
];
const state = (page: Page) =>
  page.evaluate(() => (window as any).__arena.state);
async function openBattle(page: Page) {
  await page.addInitScript((deck) => {
    localStorage.setItem(
      "browser-royale.profile.v1",
      JSON.stringify({
        version: 1,
        seenTutorial: true,
        sound: false,
        music: false,
        deck,
      }),
    );
    Math.random = () => 0;
  }, deck);
  await page.goto("/");
  await page.locator("#battle-button").click();
  await expect
    .poll(async () => (await state(page)).intro.blocking, { timeout: 60000 })
    .toBe(false);
}
async function deploy(page: Page, slot: number) {
  const card = page.locator(`#hand [data-slot="${slot}"]`);
  const touch = await page.evaluate(() => navigator.maxTouchPoints > 0);
  if (touch) await card.tap();
  else await card.click();
  await expect.poll(async () => (await state(page)).selected).toBe(slot);
  const point = await page.evaluate(() =>
    (window as any).__arena.project(4, 23),
  );
  if (touch) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
}

test("a draw retains the other three hand cards and their native SVGs", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openBattle(page);
  await expect(page.locator("#hand .native-card-ready")).toHaveCount(4, {
    timeout: 60000,
  });
  const before = await state(page),
    slot = before.hand.indexOf("skeletons");
  expect(slot).toBeGreaterThanOrEqual(0);
  await page.evaluate((slot) => {
    const root = document.querySelector("#hand")!;
    const refs = [...root.querySelectorAll<HTMLElement>("[data-slot]")].map(
      (button) => ({
        button,
        slot: Number(button.dataset.slot),
        svg: button.querySelector(".native-card-art > svg"),
      }),
    );
    const probe = {
      refs,
      rebuilds: 0,
      observer: null as MutationObserver | null,
    };
    const collect = (records: MutationRecord[]) => {
      for (const record of records) {
        const host = record.target as HTMLElement;
        if (
          host.matches?.(".native-card-art") &&
          Number(host.closest<HTMLElement>("[data-slot]")?.dataset.slot) !==
            slot
        )
          probe.rebuilds++;
      }
    };
    probe.observer = new MutationObserver(collect);
    probe.observer.observe(root, { childList: true, subtree: true });
    (window as any).__handRetention = { ...probe, collect };
    // Keep the shared counter object observed by the callback.
    (window as any).__handRetention.probe = probe;
  }, slot);
  await deploy(page, slot);
  await expect(page.locator(`#hand [data-slot="${slot}"]`)).not.toHaveAttribute(
    "data-native-card",
    "skeletons",
  );
  await expect.poll(async () => (await state(page)).selected).toBe(-1);
  await expect(
    page.locator(`#hand [data-slot="${slot}"].native-card-ready`),
  ).toHaveCount(1);
  const retained = await page.evaluate((slot) => {
    const { refs, collect, probe } = (window as any).__handRetention;
    collect(probe.observer.takeRecords());
    probe.observer.disconnect();
    return {
      buttons: refs.filter(
        (ref: any) =>
          ref.slot !== slot &&
          document.querySelector(`#hand [data-slot="${ref.slot}"]`) ===
            ref.button,
      ).length,
      svg: refs.filter(
        (ref: any) =>
          ref.slot !== slot &&
          document.querySelector(
            `#hand [data-slot="${ref.slot}"] .native-card-art > svg`,
          ) === ref.svg,
      ).length,
      rebuilds: probe.rebuilds,
    };
  }, slot);
  expect(retained).toEqual({ buttons: 3, svg: 3, rebuilds: 0 });
  // A retained button still accepts keyboard activation and deploys once.
  const second = before.hand.indexOf("fire-spirits");
  expect(second).toBeGreaterThanOrEqual(0);
  await page.locator(`#hand [data-slot="${second}"]`).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("canvas")).toBeFocused();
  await expect.poll(async () => (await state(page)).selected).toBe(second);
  await page.keyboard.press("Enter");
  await expect(
    page.locator(`#hand [data-slot="${second}"]`),
  ).not.toHaveAttribute("data-native-card", "fire-spirits");
  await expect
    .poll(
      () =>
        page
          .locator("#hand [data-slot]")
          .evaluateAll((cards) =>
            cards.map((card) => (card as HTMLElement).dataset.cardClip),
          ),
      { timeout: 30000 },
    )
    .toEqual(["hand", "hand", "hand", "hand"]);
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  await page.locator("#battle-tray").screenshot({
    path: info.outputPath("retained-native-hand.png"),
    style: "#modal-root, #toast { visibility: hidden !important; }",
  });
  await page.getByRole("button", { name: "Leave battle", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Watch replay", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  const commands = await page.evaluate(() =>
    JSON.parse(
      localStorage.getItem("browser-royale.profile.v1")!,
    ).history[0].replay.actions.filter((action: any) => action.team === "blue"),
  );
  expect(commands.map((action: any) => action.card)).toEqual([
    "skeletons",
    "fire-spirits",
  ]);
  expect(errors).toEqual([]);
});

test("retained fallback hand cards hydrate after artwork arrives", async ({
  page,
}) => {
  test.setTimeout(120000);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/assets/ui/cards/cards.json", async (route) => {
    await held;
    await route.continue();
  });
  try {
    await openBattle(page);
    expect((await state(page)).loadedCards).toBe(0);
    const before = await state(page),
      slot = before.hand.indexOf("skeletons");
    await page.evaluate(() => {
      (window as any).__fallbackHand = [
        ...document.querySelectorAll("#hand [data-slot]"),
      ];
    });
    await deploy(page, slot);
    await expect(
      page.locator(`#hand [data-slot="${slot}"]`),
    ).not.toHaveAttribute("data-native-card", "skeletons");
    release();
    await expect
      .poll(async () => (await state(page)).loadedCards, { timeout: 60000 })
      .toBe(CARDS.length);
    await expect(page.locator("#hand .native-card-ready")).toHaveCount(4);
    expect(
      await page.evaluate(
        (slot) =>
          (window as any).__fallbackHand.filter(
            (button: HTMLElement, index: number) =>
              index !== slot &&
              document.querySelector(`#hand [data-slot="${index}"]`) ===
                button &&
              button.classList.contains("native-card-ready"),
          ).length,
        slot,
      ),
    ).toBe(3);
    const retainedSlot = before.hand.indexOf("bats");
    await page.locator(`#hand [data-slot="${retainedSlot}"]`).click();
    await expect
      .poll(async () => (await state(page)).selected)
      .toBe(retainedSlot);
    await expect(page.locator("#hand-caption")).toContainText("Bats");
  } finally {
    release();
  }
});

test("repeated selection reuses normal and selected native artwork", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openBattle(page);
  await expect(page.locator("#hand .native-card-ready")).toHaveCount(4, {
    timeout: 60000,
  });
  await page.mouse.move(0, 0);
  const before = await state(page),
    slot = before.hand.indexOf("skeletons");
  expect(slot).toBeGreaterThanOrEqual(0);
  const card = page.locator(`#hand [data-slot="${slot}"]`);
  const initialSvg = await card
    .locator(".native-card-art > svg")
    .elementHandle();
  // First-use selection transitions also change SVG rasterization in the
  // uncached build. Compare stable normal poses after one complete transition.
  await page.keyboard.press(String(slot + 1));
  await page.keyboard.press(String(slot + 1));
  await expect(card).toHaveAttribute("data-card-clip", "hand");
  expect(
    await card
      .locator(".native-card-art > svg")
      .evaluate((svg, original) => svg === original, initialSvg),
  ).toBe(true);
  const pixels = await card.screenshot({
    path: info.outputPath("original-native-card.png"),
    animations: "disabled",
  });
  await page.evaluate((slot) => {
    const button = document.querySelector(`#hand [data-slot="${slot}"]`)!;
    const host = button.querySelector(".native-card-art")!;
    (window as any).__selectionViews = {
      normal: host.firstElementChild,
      selected: null,
      button,
    };
  }, slot);
  for (let cycle = 0; cycle < 10; cycle++) {
    await page.keyboard.press(String(slot + 1));
    await expect(card).toHaveAttribute("aria-pressed", "true");
    await expect(card).toHaveAttribute("data-card-clip", "hand-selected");
    expect(
      await card.evaluate((button) => {
        const saved = (window as any).__selectionViews;
        const svg = button.querySelector(".native-card-art > svg");
        if (!saved.selected) saved.selected = svg;
        return button === saved.button && svg === saved.selected;
      }),
    ).toBe(true);
    await page.keyboard.press(String(slot + 1));
    await expect(card).toHaveAttribute("aria-pressed", "false");
    await expect(card).toHaveAttribute("data-card-clip", "hand");
    expect(
      await card.evaluate(
        (button) =>
          button.querySelector(".native-card-art > svg") ===
          (window as any).__selectionViews.normal,
      ),
    ).toBe(true);
  }
  const restored = await card.screenshot({
    path: info.outputPath("cached-native-card.png"),
    animations: "disabled",
  });
  const a = await sharp(pixels)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const b = await sharp(restored)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect(a.info).toEqual(b.info);
  let delta = 0;
  for (let i = 0; i < a.data.length; i++)
    delta = Math.max(delta, Math.abs(a.data[i] - b.data[i]));
  expect(delta).toBeLessThanOrEqual(1);
  expect((await state(page)).hand).toEqual(before.hand);
  expect((await state(page)).selected).toBe(-1);
  expect(errors).toEqual([]);
});
