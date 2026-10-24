import { test, expect, type Locator } from "@playwright/test";

async function activate(control: Locator) {
  await control.focus();
  await control.press("Enter");
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "browser-royale.profile.v1",
      JSON.stringify({
        version: 1,
        seenTutorial: true,
        sound: false,
        music: false,
      }),
    );
  });
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).__arena);
});

test("closing lobby dialogs returns keyboard focus to their opener", async ({
  page,
}) => {
  const settings = page.locator("#arena-settings");
  await activate(settings);
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settings).toBeFocused();
  await activate(settings);
  await activate(
    page.getByRole("button", { name: "Save settings", exact: true }),
  );
  await expect(settings).toBeFocused();
});

test("deck redraws preserve the selected slot, filter and replacement control", async ({
  page,
}) => {
  await activate(page.locator('[data-nav="cards"]'));
  const slot = page.locator('[data-edit-slot="2"]');
  await activate(slot);
  await expect(slot).toBeFocused();
  await expect(slot).toHaveClass(/selected/);
  const filter = page.locator('[data-filter="spell"]');
  await activate(filter);
  await expect(filter).toBeFocused();
  const replacement = page.locator("[data-collection]:not(.in-deck)").first();
  const id = await replacement.getAttribute("data-collection");
  await activate(replacement);
  const same = page.locator(`[data-collection="${id}"]`);
  await expect(same).toBeFocused();
  await expect(same).toBeInViewport();
  await expect(same).toHaveClass(/in-deck/);
  await expect(page.locator('[data-edit-slot="2"]')).toHaveAttribute(
    "data-native-card",
    id!,
  );
});

test("dialog views keep their original opener and recover a rebuilt deck card", async ({
  page,
}) => {
  const cards = page.locator('[data-nav="cards"]');
  await activate(cards);
  await activate(page.locator("#deck-codes"));
  await activate(page.locator("#deck-code-back"));
  await page.keyboard.press("Escape");
  await expect(cards).toBeFocused();
  const preview = page.locator("#deck-preview [data-card-info]").first();
  const id = await preview.getAttribute("data-card-info");
  await activate(preview);
  await activate(page.locator("#card-edit-deck"));
  await activate(page.locator('[data-edit-slot="7"]'));
  await activate(page.locator("[data-collection]:not(.in-deck)").first());
  await activate(page.locator("#deck-done"));
  await expect(
    page.locator(`#deck-preview [data-card-info="${id}"]`),
  ).toBeFocused();
  await activate(page.locator(`#deck-preview [data-card-info="${id}"]`));
  await activate(page.locator("#card-edit-deck"));
  await activate(page.locator('[data-edit-slot="0"]'));
  await activate(page.locator("[data-collection]:not(.in-deck)").first());
  await activate(page.locator("#deck-done"));
  await expect(page.locator("#battle-button")).toBeFocused();
});

test("open dialogs make the background inert and retain native Tab order", async ({
  page,
}) => {
  await activate(page.locator('[data-nav="cards"]'));
  const close = page.getByRole("button", { name: "Close dialog", exact: true });
  await expect(close).toBeFocused();
  expect(
    await page.locator(".app-shell").evaluate((e) => (e as HTMLElement).inert),
  ).toBe(true);
  await page
    .locator("#battle-button")
    .evaluate((e) => (e as HTMLElement).focus());
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator("#deck-done")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  expect(
    await page.locator(".app-shell").evaluate((e) => (e as HTMLElement).inert),
  ).toBe(false);
  await expect(page.locator('[data-nav="cards"]')).toBeFocused();
});

test("an invalid invite redraw preserves the focused text and selection", async ({
  page,
}) => {
  const friend = page.locator("#friend-button");
  await activate(friend);
  const field = page.locator("#peer-invite");
  await field.fill("invalid invite code");
  await field.evaluate((element: HTMLTextAreaElement) =>
    element.setSelectionRange(2, 7, "backward"),
  );
  await page
    .locator("#peer-join-form")
    .evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator(".room-error")).not.toBeEmpty();
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("invalid invite code");
  expect(
    await field.evaluate((element: HTMLTextAreaElement) => ({
      start: element.selectionStart,
      end: element.selectionEnd,
      direction: element.selectionDirection,
    })),
  ).toEqual({ start: 2, end: 7, direction: "backward" });
  await page.keyboard.insertText("X");
  await expect(field).toHaveValue("inX invite code");
  await page.keyboard.press("Escape");
  await expect(friend).toBeFocused();
});
