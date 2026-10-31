import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
const fixture = JSON.parse(
  readFileSync("tests/fixtures/combat-v4-replay.json", "utf8"),
);

test.beforeEach(async ({ page }) => {
  await page.addInitScript((replay) => {
    const key = "browser-royale.profile.v1";
    if (localStorage.getItem(key)) return;
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        name: "Backup King",
        gold: 3456,
        trophies: 123,
        best: 123,
        battles: 1,
        seenTutorial: true,
        sound: false,
        history: [
          {
            id: 42,
            date: "2026-10-22T12:00:00.000Z",
            mode: "classic",
            winner: "red",
            crowns: [0, 3],
            replay,
          },
        ],
      }),
    );
  }, fixture.replay);
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).__arena);
  await page
    .getByRole("button", { name: "Battle settings", exact: true })
    .click();
});

test("exports a file, previews and cancels restoration, then restores all saved progress across reload", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export progress", exact: true })
    .click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(
    /^browser-arena-progress-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z-for-backup-king\.json$/,
  );
  const backupPath = (await download.path())!;
  const backup = JSON.parse(await readFile(backupPath, "utf8"));
  expect(backup.profile).toMatchObject({
    name: "Backup King",
    gold: 3456,
    trophies: 123,
  });
  // Bare history has no local provenance; export pins its origin default.
  expect(backup.profile.history[0].replay).toEqual({
    ...fixture.replay,
    rulesFamily: "origin",
  });
  await page.getByLabel("PLAYER NAME", { exact: true }).fill("Current King");
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  const current = await page.evaluate(() =>
    localStorage.getItem("browser-royale.profile.v1"),
  );
  await page
    .getByRole("button", { name: "Battle settings", exact: true })
    .click();
  await page.locator("#progress-file").setInputFiles(backupPath);
  await expect(
    page.getByRole("heading", { name: "Restore your kingdom?" }),
  ).toBeVisible();
  await expect(page.locator(".restore-progress")).toContainText("Backup King");
  await page.screenshot({
    path: info.outputPath("restore-progress.png"),
    animations: "disabled",
  });
  expect(
    await page.evaluate(() =>
      localStorage.getItem("browser-royale.profile.v1"),
    ),
  ).toBe(current);
  await page
    .getByRole("button", { name: "Keep current progress", exact: true })
    .click();
  await expect(page.getByLabel("PLAYER NAME", { exact: true })).toHaveValue(
    "Current King",
  );
  await page.locator("#progress-file").setInputFiles(backupPath);
  await page
    .getByRole("button", { name: "Restore progress", exact: true })
    .click();
  await expect(page.locator("#toast")).toHaveText("Progress restored.");
  const restored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("browser-royale.profile.v1")!),
  );
  expect(restored).toEqual(backup.profile);
  await page.reload();
  await page
    .getByRole("button", { name: "Battle settings", exact: true })
    .click();
  await expect(page.getByLabel("PLAYER NAME", { exact: true })).toHaveValue(
    "Backup King",
  );
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("button", { name: "Battle log", exact: true }).click();
  await expect(page.locator("[data-replay]")).toHaveCount(1);
  await page.locator("[data-replay]").click();
  await expect(page.locator(".replay-controls")).toBeVisible();
  await page.getByRole("slider", { name: "Replay timeline" }).focus();
  await page.getByRole("slider", { name: "Replay timeline" }).press("End");
  await expect
    .poll(() => page.evaluate(() => (window as any).__arena.state.winner))
    .toBe("red");
  expect(errors).toEqual([]);
});

test("rejects broken and oversized backups without changing current progress", async ({
  page,
}, info) => {
  const current = await page.evaluate(() =>
    localStorage.getItem("browser-royale.profile.v1"),
  );
  for (const [contents, message] of [
    ["{broken", "not a Browser Arena progress backup"],
    [
      JSON.stringify({
        format: "browser-royale-progress",
        version: 1,
        profile: { version: 1 },
      }),
      "incomplete or invalid progress",
    ],
    [" ".repeat(2_000_001), "smaller than 2 MB"],
  ]) {
    await page.locator("#progress-file").setInputFiles({
      name: "progress.json",
      mimeType: "application/json",
      buffer: Buffer.from(contents),
    });
    await expect(page.getByRole("alert")).toContainText(message);
    expect(
      await page.evaluate(() =>
        localStorage.getItem("browser-royale.profile.v1"),
      ),
    ).toBe(current);
    await expect(
      page.getByRole("button", { name: "Restore backup", exact: true }),
    ).toBeEnabled();
  }
  await page.screenshot({
    path: info.outputPath("backup-error.png"),
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("backup controls fit narrow screens, keep keyboard focus in the dialog and stay out of live battles", async ({
  page,
}, info) => {
  if (info.project.name !== "desktop")
    await page.setViewportSize({ width: 320, height: 568 });
  const first = page.getByRole("button", { name: "Close dialog", exact: true });
  const last = page.getByRole("button", {
    name: "Restore backup",
    exact: true,
  });
  await first.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(last).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(first).toBeFocused();
  for (const name of ["Export progress", "Restore backup"]) {
    const button = page.getByRole("button", { name, exact: true });
    await button.scrollIntoViewIfNeeded();
    const box = (await button.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
  await page.screenshot({
    path: info.outputPath("backup-controls.png"),
    animations: "disabled",
  });
  await first.click();
  await page.locator("#battle-button").click();
  await page.locator("#arena-settings").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator(".progress-backup")).toHaveCount(0);
});

test("keeps restored progress usable and exportable when browser storage refuses writes", async ({
  page,
}) => {
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export progress", exact: true })
    .click();
  const download = await downloadEvent;
  const backup = JSON.parse(await readFile((await download.path())!, "utf8"));
  backup.profile.name = "Session King";
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Storage is full", "QuotaExceededError");
    };
  });
  await page.locator("#progress-file").setInputFiles({
    name: "progress.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await page
    .getByRole("button", { name: "Restore progress", exact: true })
    .click();
  await expect(page.locator("#toast")).toHaveText(
    "Progress restored for this session. Browser storage is unavailable.",
  );
  await page
    .getByRole("button", { name: "Battle settings", exact: true })
    .click();
  await expect(page.getByLabel("PLAYER NAME", { exact: true })).toHaveValue(
    "Session King",
  );
  const secondDownloadEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export progress", exact: true })
    .click();
  const secondDownload = await secondDownloadEvent;
  expect(
    JSON.parse(await readFile((await secondDownload.path())!, "utf8")),
  ).toEqual(backup);
});
