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
    await expect(page.locator("#fullscreen")).toBeEnabled();
    await expect(page.locator("#fullscreen")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(page.locator("#fullscreen")).toHaveAttribute(
      "aria-pressed",
      String(failure === "exit"),
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
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => (window as any).__fullscreenCalls)).toEqual([
    "request",
    "exit",
  ]);
  await expect(page.locator("#toast")).not.toContainText(
    "Fullscreen is unavailable",
  );
  expect(errors).toEqual([]);
});

test("fullscreen state and pending requests survive settings reopen and Help without losing drafts", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((key) => {
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        name: "Fullscreen King",
        sound: false,
        music: false,
        seenTutorial: true,
      }),
    );
    let active = false;
    let release: (() => void) | undefined;
    const control = {
      requests: 0,
      exits: 0,
      setActive(value: boolean) {
        active = value;
        document.dispatchEvent(new Event("fullscreenchange"));
      },
      finishRequest() {
        control.setActive(true);
        release?.();
      },
    };
    (window as any).__fullscreenControl = control;
    Object.defineProperty(document, "fullscreenElement", {
      get: () => (active ? document.documentElement : null),
      configurable: true,
    });
    Object.defineProperty(Element.prototype, "requestFullscreen", {
      configurable: true,
      value: function () {
        control.requests++;
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: function () {
        control.exits++;
        control.setActive(false);
        return Promise.resolve();
      },
    });
  }, key);
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).__arena);
  const before = await page.evaluate((key) => localStorage.getItem(key), key);
  await page.locator("#arena-settings").click();
  const toggle = page.getByRole("button", {
    name: "Toggle fullscreen",
    exact: true,
  });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(toggle).toHaveAttribute("title", "Enter fullscreen");
  await toggle.click();
  await expect(toggle).toBeDisabled();
  await expect(toggle).toHaveAttribute("aria-busy", "true");
  await toggle.evaluate((button) => {
    (button as HTMLButtonElement).click();
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(
    await page.evaluate(() => (window as any).__fullscreenControl.requests),
  ).toBe(1);
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.locator("#arena-settings").click();
  await expect(toggle).toBeDisabled();
  await expect(toggle).toHaveAttribute("aria-busy", "true");
  await page.evaluate(() =>
    (window as any).__fullscreenControl.finishRequest(),
  );
  await expect(toggle).toBeEnabled();
  await expect(toggle).toHaveAttribute("aria-busy", "false");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(toggle).toHaveAttribute("title", "Exit fullscreen");
  await page.locator("#player-name").fill("Retained draft");
  await page
    .getByRole("checkbox", { name: "Sound effects", exact: true })
    .check();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "How to play", exact: true })
    .click();
  await page.evaluate(() =>
    (window as any).__fullscreenControl.setActive(false),
  );
  await page
    .getByRole("button", { name: "Back to settings", exact: true })
    .click();
  await expect(page.locator("#player-name")).toHaveValue("Retained draft");
  await expect(
    page.getByRole("checkbox", { name: "Sound effects", exact: true }),
  ).toBeChecked();
  await expect(page.locator("#settings-help")).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(toggle).toHaveAttribute("title", "Enter fullscreen");
  await page.evaluate(() =>
    (window as any).__fullscreenControl.setActive(true),
  );
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(toggle).toHaveAttribute("title", "Exit fullscreen");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(toggle).toHaveAttribute("aria-busy", "false");
  await expect(toggle).toBeEnabled();
  expect(
    await page.evaluate(() => ({
      requests: (window as any).__fullscreenControl.requests,
      exits: (window as any).__fullscreenControl.exits,
    })),
  ).toEqual({ requests: 1, exits: 1 });
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    before,
  );
  expect(errors).toEqual([]);
});
