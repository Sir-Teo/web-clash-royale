import { test, expect } from "@playwright/test";

test("results become available on authored time even when frames arrive slowly", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "browser-royale.profile.v1",
      JSON.stringify({
        version: 1,
        sound: false,
        music: false,
        seenTutorial: true,
      }),
    );
    const request = requestAnimationFrame.bind(window);
    const cancel = cancelAnimationFrame.bind(window);
    let serial = 0;
    const pending = new Map<number, { frame?: number; timer?: number }>();
    window.requestAnimationFrame = (callback) => {
      const id = ++serial;
      const entry: { frame?: number; timer?: number } = {};
      pending.set(id, entry);
      const schedule = () => {
        entry.frame = request((now) => {
          pending.delete(id);
          callback(now);
        });
      };
      if ((window as any).slowFrames)
        entry.timer = window.setTimeout(schedule, 1500);
      else schedule();
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      const entry = pending.get(id);
      if (!entry) return;
      if (entry.frame !== undefined) cancel(entry.frame);
      if (entry.timer !== undefined) clearTimeout(entry.timer);
      pending.delete(id);
    };
  });
  await page.goto("/");
  await expect(page.locator("#battle-button")).toBeVisible({ timeout: 60000 });
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__arena.state.loadedEndings),
      { timeout: 30000 },
    )
    .toBe(5);
  await page.locator("#battle-button").click();
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__arena.state.intro.blocking),
      { timeout: 15000 },
    )
    .toBe(false);
  await page.evaluate(() => {
    (window as any).slowFrames = true;
  });
  await page.getByRole("button", { name: "Pause battle" }).click();
  const started = Date.now();
  await page.getByRole("button", { name: "Leave battle", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Watch replay", exact: true }),
  ).toBeVisible({ timeout: 12000 });
  expect(Date.now() - started).toBeGreaterThan(5000);
  expect(await page.evaluate(() => (window as any).__arena.state.winner)).toBe(
    "red",
  );
});
