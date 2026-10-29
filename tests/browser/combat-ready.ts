import { expect, type Page } from "@playwright/test";

/** The final artwork rebuild resets transient presentations in this fixture. */
export async function waitForCombatScene(page: Page) {
  await expect
    .poll(() => page.evaluate(() => (window as any).__geometryLayout?.ready), {
      timeout: 60000,
    })
    .toBe(true);
}
