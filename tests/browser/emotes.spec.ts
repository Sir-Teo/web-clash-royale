import { test, expect, type Locator } from "@playwright/test";
import { QUICK_CHATS, QUICK_CHAT_LABELS } from "../../src/game/emotes";
const state = (page: any) =>
  page.evaluate(() => (window as any).__arena?.state);
test("all sixteen native King voices decode in the browser", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/emotes.html");
  const voices = await page.evaluate(async () => {
    const data = await (await fetch("/assets/ui/emotes/emotes.json")).json();
    const names = Object.values(data.voices).flatMap(
      (voice: any) => voice.files,
    ) as string[];
    return Promise.all(
      names.map(
        (name) =>
          new Promise<{ name: string; duration: number }>((resolve, reject) => {
            const audio = new Audio(`/assets/audio/${name}.ogg`);
            const timer = setTimeout(
              () => finish(new Error(`${name}: decode timeout`)),
              10000,
            );
            function finish(error?: Error) {
              clearTimeout(timer);
              audio.oncanplay = null;
              audio.onerror = null;
              const duration = audio.duration;
              audio.pause();
              audio.removeAttribute("src");
              audio.load();
              if (error) reject(error);
              else resolve({ name, duration });
            }
            audio.oncanplay = () => finish();
            audio.onerror = () =>
              finish(
                new Error(
                  `${name}: ${audio.error?.message ?? "decode failed"}`,
                ),
              );
            audio.preload = "auto";
            audio.load();
          }),
      ),
    );
  });
  expect(voices).toHaveLength(16);
  expect(
    voices.every(
      (voice) => Number.isFinite(voice.duration) && voice.duration > 0,
    ),
  ).toBe(true);
});
test("native emotes preserve both bubbles, four expressions, manual frames and reduced motion", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/tests/fixtures/emotes.html");
  await expect(page.locator("#status")).toContainText("17 native clips");
  const blue = page.locator(".native-emote-bubble.blue"),
    red = page.locator(".native-emote-bubble.red");
  await page.getByRole("button", { name: "Show player", exact: true }).click();
  await page.locator("#time").fill("0.5");
  await expect(blue).toHaveAttribute("data-frame", "30");
  await page.locator("#kind").selectOption("cry");
  await page
    .getByRole("button", { name: "Show opponent", exact: true })
    .click();
  await expect(red).toHaveAttribute("data-frame", "0");
  await expect(blue).toHaveAttribute("data-frame", "30");
  await page.locator("#time").fill("1");
  await expect(blue).toHaveAttribute("data-expression", "20");
  await expect(red).toHaveAttribute("data-expression", "14");
  const held = await blue.innerHTML();
  await page.waitForTimeout(150);
  expect(await blue.innerHTML()).toBe(held);
  await page.getByRole("button", { name: "Step frame", exact: true }).click();
  await expect(blue).toHaveAttribute("data-frame", "61");
  await page.screenshot({
    path: `test-results/${info.project.name}-native-emotes.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "King emotes", exact: true }).click();
  await expect(page.locator("[data-emote] svg")).toHaveCount(4);
  await expect(page.locator("[data-quick-chat] svg text")).toHaveCount(6);
  await page.screenshot({
    path: `test-results/${info.project.name}-native-emote-selector.png`,
    fullPage: true,
  });
  for (const kind of ["angry", "thumbs"]) {
    await page.locator("#kind").selectOption(kind);
    await page
      .getByRole("button", { name: "Show player", exact: true })
      .click();
    await expect(blue).toHaveAttribute("data-kind", kind);
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator("#time").fill("0.5");
  await expect(blue).toHaveAttribute("data-frame", "60");
  const reduced = await blue.innerHTML();
  await page.locator("#time").fill("1.5");
  expect(await blue.innerHTML()).toBe(reduced);
  await page.locator("#time").fill("2.5");
  await expect(blue).toBeHidden();
  await expect(red).toBeHidden();
  expect(errors).toEqual([]);
});
test("native quick chat renders every phrase on both sides with the archived font", async ({
  page,
}, info) => {
  await page.goto("/tests/fixtures/emotes.html");
  await expect(page.locator("#status")).toContainText("17 native clips");
  expect(
    await page.evaluate(() => document.fonts.check('22px "SC CCBackBeat"')),
  ).toBe(true);
  for (const phrase of QUICK_CHATS) {
    await page.locator("#kind").selectOption(phrase);
    for (const team of ["blue", "red"] as const) {
      await page.locator(`#${team}-show`).click();
      await page.locator("#time").fill("1");
      const bubble = page.locator(`.native-emote-bubble.${team}`);
      await expect(bubble).toHaveAttribute("data-kind", phrase);
      await expect(bubble.locator("text")).toHaveText(
        QUICK_CHAT_LABELS[phrase],
      );
      expect(
        await bubble
          .locator("text")
          .evaluate((n) => getComputedStyle(n).fontFamily),
      ).toContain("SC CCBackBeat");
      const visible = await bubble.locator("text").boundingBox();
      const box = await bubble.boundingBox();
      expect(visible!.width).toBeGreaterThan(15);
      expect(visible!.x).toBeGreaterThanOrEqual(box!.x);
      expect(visible!.x + visible!.width).toBeLessThanOrEqual(
        box!.x + box!.width,
      );
    }
  }
  await page.locator("#kind").selectOption("well-played");
  await page.locator("#blue-show").click();
  await page.locator("#kind").selectOption("good-luck");
  await page.locator("#red-show").click();
  await page.locator("#time").fill("1");
  await page.screenshot({
    path: `test-results/${info.project.name}-native-quick-chat.png`,
    fullPage: true,
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator("#time").fill("1.5");
  await expect(page.locator(".native-emote-bubble.blue")).toHaveAttribute(
    "data-frame",
    "60",
  );
  await page.locator("#time").fill("2.5");
  await expect(page.locator(".native-emote-bubble.blue")).toBeHidden();
});
test("battle emotes have touch controls, cooldown, mute persistence and lifecycle cleanup", async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("browser-royale.profile.v1"))
      localStorage.setItem(
        "browser-royale.profile.v1",
        JSON.stringify({ version: 1, sound: false, seenTutorial: true }),
      );
  });
  await page.goto("/");
  await expect
    .poll(async () => (await state(page))?.loadedEmotes, { timeout: 30000 })
    .toBe(17);
  await page.locator("#battle-button").click();
  await expect.poll(async () => (await state(page)).intro.blocking).toBe(false);
  const toggle = page.getByRole("button", { name: "King emotes", exact: true });
  const press = (element: Locator) =>
    info.project.name === "desktop" ? element.click() : element.tap();
  await press(toggle);
  const menu = page.getByRole("group", { name: "King emotes", exact: true });
  await expect(menu).toBeVisible();
  const boxes = await page
    .locator("[data-emote],[data-quick-chat],.emote-mute,#emote-button")
    .evaluateAll((nodes) =>
      nodes.map((n) => {
        const r = n.getBoundingClientRect();
        return { w: r.width, h: r.height };
      }),
    );
  expect(boxes.every((r) => r.w >= 44 && r.h >= 44)).toBe(true);
  await press(
    page.getByRole("button", { name: "Send King laugh", exact: true }),
  );
  const blue = page.locator(".native-emote-bubble.blue");
  await expect(blue).toHaveAttribute("data-kind", "laugh");
  await toggle.click();
  await expect(
    page.getByRole("button", { name: "Send King cry", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Send Good luck!", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  expect((await state(page)).paused).toBe(false);
  await toggle.click();
  await page.getByRole("button", { name: "Mute emotes", exact: true }).click();
  await expect(blue).toBeHidden();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("browser-royale.profile.v1")!)
          .emotesMuted,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Unmute emotes", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Send King thumbs up", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Send King thumbs up", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  const held = await blue.innerHTML();
  await page.waitForTimeout(200);
  expect(await blue.innerHTML()).toBe(held);
  await page
    .getByRole("button", { name: "Resume battle", exact: true })
    .click();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect((await state(page)).emotes.blue).toBeNull();
  await page.evaluate(() => {
    delete (document as any).hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page
    .getByRole("button", { name: "Resume battle", exact: true })
    .click();
  if (info.project.name !== "desktop")
    await page.setViewportSize({ width: 844, height: 390 });
  await toggle.click();
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  const size = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(size.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(size.height);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: `test-results/${info.project.name}-battle-emote-menu.png`,
    fullPage: true,
  });
  const chat = page.getByRole("button", {
    name: "Send Well played!",
    exact: true,
  });
  await expect(chat).toBeEnabled();
  await press(chat);
  await expect(blue).toHaveAttribute("data-kind", "well-played");
  await toggle.click();
  await expect(
    page.getByRole("button", { name: "Send King laugh", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Mute emotes", exact: true }).click();
  await expect(blue).toBeHidden();
  await page.reload();
  await expect
    .poll(async () => (await state(page))?.emotes.muted, { timeout: 30000 })
    .toBe(true);
});
test("missing native emote assets retain working text reactions", async ({
  page,
}) => {
  await page.route("**/assets/ui/emotes/emotes.json", (r) => r.abort());
  await page.goto("/tests/fixtures/emotes.html");
  await page.getByRole("button", { name: "Show player", exact: true }).click();
  await expect(page.locator(".native-emote-bubble.blue")).toHaveText("Ha ha!");
  await page.locator("#kind").selectOption("good-game");
  await page.locator("#red-show").click();
  await expect(page.locator(".native-emote-bubble.red")).toHaveText(
    "Good game!",
  );
  await page.getByRole("button", { name: "King emotes", exact: true }).click();
  await page.getByRole("button", { name: "Mute emotes", exact: true }).click();
  await expect(page.locator(".native-emote-bubble.blue")).toBeHidden();
  await expect(page.locator(".native-emote-bubble.red")).toBeHidden();
});
