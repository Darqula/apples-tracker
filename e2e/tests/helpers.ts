import type { Page } from "@playwright/test";

export const SCREENSHOT_DIR = "e2e/screenshots";

export async function screenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}`, fullPage: true });
}

export async function gotoPostings(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
}

/** Removes a trailing marker after submit clicks: waits for the element to detach. */
export async function expectDetached(
  page: Page,
  selector: string,
): Promise<void> {
  await page
    .locator(selector)
    .waitFor({ state: "detached" });
}

export function timestamp(): string {
  return new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 13);
}
