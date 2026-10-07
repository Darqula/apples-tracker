// Mutating tests: the shared AI context note (last mutating file runs last).
import { expect, test } from "@playwright/test";
import { gotoPostings } from "./helpers";

async function openContext(page: import("@playwright/test").Page): Promise<void> {
  await gotoPostings(page);
  await page.locator('.tab-button:has-text("AI Context")').click();
  await expect(page.locator(".context-textarea")).toBeVisible();
}

test("edit shows Unsaved changes, Save confirms and persists after reload", async ({ page }) => {
  await openContext(page);
  const textarea = page.locator(".context-textarea");
  await textarea.fill("# Job search context\n\n## E2E edited note\n\nPersisted across reload.");
  await expect(page.locator(".status-dirty")).toHaveText("Unsaved changes");

  await page.locator('.context-actions button:has-text("Save")').click();

  // The seeded note is long, so cutting it to a few lines trips the server's
  // shrink guard: the UI asks before sending the draft again with force.
  const shrinkBanner = page.locator(".banner-warning");
  await expect(shrinkBanner).toContainText("less than 50%");
  await shrinkBanner.locator('button:has-text("Save anyway")').click();
  await expect(page.locator(".status-saved")).toHaveText("Saved");

  await page.reload();
  await openContext(page);
  const value = await page.locator(".context-textarea").inputValue();
  expect(value).toContain("Persisted across reload.");
});

test("conflict flow: API write behind the UI triggers the changed-elsewhere banner", async ({
  page,
}) => {
  const apiContent = `# Job search context\n\n## Written by the API at ${Date.now()}\n`;

  await openContext(page);
  // The note loaded in the UI (baseline set). After this, the UI's textarea
  // already shows the current content — writing behind the UI invalidates it.
  const textarea = page.locator(".context-textarea");
  const initial = await textarea.inputValue();
  expect(initial.length).toBeGreaterThan(0);

  // Someone else (the API) overwrites the note while the UI holds the old version.
  const current = await (await page.request.get("/api/context")).json();
  const put = await page.request.put("/api/context", {
    data: { content: apiContent, expectedUpdatedAt: current.updatedAt },
  });
  expect(put.ok()).toBeTruthy();

  // Make an edit in the UI and save → 409 → the warning banner appears.
  await textarea.fill(initial + "\nExtra line from the UI.");
  await expect(page.locator(".status-dirty")).toHaveText("Unsaved changes");
  await page.locator('.context-actions button:has-text("Save")').click();

  const banner = page.locator(".banner-warning");
  await expect(banner).toBeVisible({ timeout: 10_000 });
  await expect(banner).toContainText("changed elsewhere");
  const loadLatest = banner.locator('button:has-text("Load latest (discard my edits)")');
  await expect(loadLatest).toBeVisible();
  await expect(banner.locator('button:has-text("Overwrite anyway")')).toBeVisible();

  // "Load latest" replaces the draft with the API-written content.
  await loadLatest.click();
  await expect(banner).toBeHidden({ timeout: 10_000 });
  const value = await page.locator(".context-textarea").inputValue();
  expect(value).toBe(apiContent);
  // The conflict is resolved; the draft is clean again.
  await expect(page.locator(".status-dirty")).toHaveCount(0);
});

test("history lists earlier versions and loads one into the editor as a draft", async ({ page }) => {
  // Create two versions through the API so the test does not depend on earlier ones.
  for (const content of ["# History A", "# History B"]) {
    const current = await (await page.request.get("/api/context")).json();
    const put = await page.request.put("/api/context", {
      data: { content, expectedUpdatedAt: current.updatedAt },
    });
    expect(put.ok()).toBeTruthy();
  }

  await openContext(page);
  await page.locator('.context-actions button:has-text("History")').click();

  const items = page.locator(".context-history-item");
  await expect(items.first()).toBeVisible({ timeout: 10_000 });

  await items.first().locator('button:has-text("Load into editor")').click();
  // Loading only fills the editor; the user still has to save it.
  await expect(page.locator(".status-dirty")).toHaveText("Unsaved changes");
});
