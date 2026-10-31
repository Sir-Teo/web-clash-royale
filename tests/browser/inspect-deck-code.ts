import { expect, type Locator, type Page } from "@playwright/test";
import type { CardId } from "../../src/game/cards";
import { encodeDeckCode } from "../../src/game/deck-code";

export async function inspectDeckCode(
  page: Page,
  control: Locator,
  deck: readonly CardId[],
  backLabel: string,
) {
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as any).__previewDeckCode = value;
        },
      },
    });
  });
  await control.scrollIntoViewIfNeeded();
  const scroll = await page
    .getByRole("dialog")
    .evaluate((dialog) => dialog.scrollTop);
  expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  if (await page.evaluate(() => navigator.maxTouchPoints > 0))
    await control.tap();
  else {
    await control.focus();
    await control.press("Enter");
  }
  const code = encodeDeckCode(deck);
  await expect(
    page.getByRole("textbox", { name: "Deck code", exact: true }),
  ).toHaveValue(code);
  await page
    .getByRole("button", { name: "Copy deck code", exact: true })
    .click();
  await expect(page.locator("#battle-code-status")).toHaveText(
    "Deck code copied.",
  );
  expect(await page.evaluate(() => (window as any).__previewDeckCode)).toBe(
    code,
  );
  await page.getByRole("button", { name: backLabel, exact: true }).click();
  await expect(control).toBeFocused();
  expect(
    await page.getByRole("dialog").evaluate((dialog) => dialog.scrollTop),
  ).toBeCloseTo(scroll, 0);
}
