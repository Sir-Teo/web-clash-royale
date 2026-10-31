import { test, expect } from "@playwright/test";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";

test("settings expose named audio controls with independent 44-pixel touch targets", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((key) => {
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        name: "Audio King",
        sound: false,
        music: false,
        seenTutorial: true,
      }),
    );
  }, key);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).__arena);
  const before = await page.evaluate((key) => localStorage.getItem(key), key);
  await page.locator("#arena-settings").click();
  const sound = page.getByRole("checkbox", {
    name: "Sound effects",
    exact: true,
  });
  const music = page.getByRole("checkbox", {
    name: "Battle music",
    exact: true,
  });
  for (const control of [
    sound,
    music,
    page.getByRole("button", { name: "Toggle fullscreen", exact: true }),
  ]) {
    const bounds = (await control.boundingBox())!;
    expect(bounds.width).toBeGreaterThanOrEqual(44);
    expect(bounds.height).toBeGreaterThanOrEqual(44);
  }
  expect(
    await page
      .getByRole("dialog")
      .evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth + 1),
  ).toBe(true);
  await sound.check();
  await music.check();
  await sound.uncheck();
  await expect(sound).not.toBeChecked();
  await expect(music).toBeChecked();
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    before,
  );
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  expect(
    await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key),
  ).toMatchObject({ sound: false, music: true });
  expect(errors).toEqual([]);
});

for (const failure of ["unsupported", "request", "exit"] as const)
  test(`fullscreen ${failure} failure stays in settings with feedback and no uncaught error`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      ({ key, failure }) => {
        localStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            name: "Fullscreen King",
            sound: false,
            seenTutorial: true,
          }),
        );
        const reject = () => Promise.reject(new Error("Fullscreen denied"));
        if (failure === "unsupported")
          Object.defineProperty(Element.prototype, "requestFullscreen", {
            value: undefined,
            configurable: true,
          });
        else if (failure === "request")
          Object.defineProperty(Element.prototype, "requestFullscreen", {
            value: reject,
            configurable: true,
          });
        else {
          Object.defineProperty(document, "fullscreenElement", {
            get: () => document.documentElement,
            configurable: true,
          });
          Object.defineProperty(document, "exitFullscreen", {
            value: reject,
            configurable: true,
          });
        }
      },
      { key, failure },
    );
    await page.goto("/");
    await page.waitForFunction(() => !!(window as any).__arena);
    const before = await page.evaluate((key) => localStorage.getItem(key), key);
    await page.locator("#arena-settings").click();
    await page.locator("#player-name").fill("Unsaved King");
    await page.locator("#fullscreen").click();
    await expect(page.locator("#toast")).toHaveText(
      "Fullscreen is unavailable in this browser.",
    );
    await expect(page.locator("#fullscreen")).toHaveAccessibleName(
      "Toggle fullscreen",
    );
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.locator("#player-name")).toHaveValue("Unsaved King");
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
      before,
    );
    expect(errors).toEqual([]);
  });

test("fullscreen keeps native request and exit receiver bindings", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((key) => {
    localStorage.setItem(
      key,
      JSON.stringify({ version: 1, sound: false, seenTutorial: true }),
    );
    let active = false;
    const calls: string[] = [];
    (window as any).__fullscreenCalls = calls;
    Object.defineProperty(document, "fullscreenElement", {
      get: () => (active ? document.documentElement : null),
      configurable: true,
    });
    Object.defineProperty(Element.prototype, "requestFullscreen", {
      configurable: true,
      value: function (this: HTMLElement) {
        if (this !== document.documentElement)
          throw new Error("Wrong fullscreen element");
        calls.push("request");
        active = true;
        return Promise.resolve();
      },
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: function (this: Document) {
        if (this !== document) throw new Error("Wrong fullscreen document");
        calls.push("exit");
        active = false;
        return Promise.resolve();
      },
    });
  }, key);
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).__arena);
  await page.locator("#arena-settings").click();
  const toggle = page.getByRole("button", {
    name: "Toggle fullscreen",
    exact: true,
  });
  await toggle.click();
  await toggle.click();
  expect(await page.evaluate(() => (window as any).__fullscreenCalls)).toEqual([
    "request",
    "exit",
  ]);
  await expect(page.locator("#toast")).not.toContainText(
    "Fullscreen is unavailable",
  );
  expect(errors).toEqual([]);
});
