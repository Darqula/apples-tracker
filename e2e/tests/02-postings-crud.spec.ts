// Mutating tests: posting CRUD. Workers=1, runs after 01-browse; creates its
// own uniquely named data only.
import { expect, test } from "@playwright/test";
import { gotoPostings, screenshot, timestamp } from "./helpers";

const company = `E2E Corp ${timestamp()}`;
const title = `Backend Gatekeeper ${timestamp()}`;

test("press n opens the new-posting modal; empty submit shows validation errors", async ({
  page,
}) => {
  await gotoPostings(page);
  await page.locator("body").press("n");
  const dialog = page.locator("dialog[open].modal");
  const heading = dialog.locator(".modal-title");
  await expect(heading).toBeVisible();
  expect((await heading.textContent()).trim()).toBe("New posting");
  // Submit with everything empty.
  await dialog.locator('button:has-text("Create posting")').click();
  const errors = dialog.locator(".form-field-error");
  const messages = (await errors.allTextContents()).join(" | ");
  expect(messages.length).toBeGreaterThan(0);
  // Modal stays open.
  await expect(dialog).toBeVisible();

  // The company field suggests existing companies (datalist option values).
  const options = await dialog
    .locator("#posting-form-companies option")
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value));
  expect(options).toContain("Acme Robotics");
});

test("create a posting for a new company with state Interview", async ({ page }) => {
  await gotoPostings(page);
  await page.locator("body").press("n");
  const dialog = page.locator("dialog[open].modal");
  await dialog.getByLabel("Company").fill(company);
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByLabel("State").selectOption("interview");
  await dialog.getByLabel("Applied date").fill("2026-09-01");
  await dialog
    .getByLabel(/URLs/)
    .fill("https://example.com/careers/e2e-gatekeeper");
  // Screenshot of the open (filled) create modal, before submitting.
  await screenshot(page, "posting-form.png");
  await dialog.locator('button:has-text("Create posting")').click();

  // Modal closes, details panel opens for the created posting.
  await expect(dialog).toBeHidden({ timeout: 10_000 });
  const panel = page.locator(".posting-details");
  await expect(panel).toBeVisible();
  await expect(panel.locator(".posting-details-title")).toHaveText(title);
  // It lives under the Interview group.
  const interviewGroup = page.locator(".posting-group", { has: page.locator('.group-label:text-is("Interview")') });
  await expect(interviewGroup.locator("tbody tr", { hasText: title })).toBeVisible();
});

test("new company exists on the Companies tab; form suggests Acme Robotics", async ({
  page,
}) => {
  // Open the create modal again to inspect the datalist, then cancel.
  await gotoPostings(page);
  await page.locator("body").press("n");
  const dialog = page.locator("dialog[open].modal");
  const options = await dialog
    .locator("#posting-form-companies option")
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value));
  expect(options).toContain("Acme Robotics");
  await expect(options).toContain(company);
  await dialog.locator('button:has-text("Cancel")').click();

  // The E2E company exists on the Companies tab.
  await page.locator('.tab-button:has-text("Companies")').click();
  await expect(page.locator("tbody tr", { hasText: company })).toBeVisible();
  await expect(page.locator(".page-count")).toHaveText("7 companies");
});

test("edit the created posting: change state to Offer, clear applied date", async ({
  page,
}) => {
  await gotoPostings(page);
  await page
    .locator("tbody tr", { hasText: title })
    .first()
    .click();
  const panel = page.locator(".posting-details");
  await expect(panel).toBeVisible();

  await panel.locator('button:has-text("Edit")').click();
  const dialog = page.locator("dialog[open].modal");
  await expect(dialog.locator(".modal-title")).toHaveText("Edit posting");
  await dialog.getByLabel("State").selectOption("offer");
  await dialog.getByLabel("Applied date").fill("");
  await dialog.locator('button:has-text("Save changes")').click();

  await expect(dialog).toBeHidden({ timeout: 10_000 });
  // The posting now lives in the Offer group; row badge and panel show offer.
  const offerGroup = page.locator(".posting-group", {
    has: page.locator('.group-label:text-is("Offer")'),
  });
  await expect(offerGroup.locator("tbody tr", { hasText: title })).toBeVisible();
  await expect(panel.locator(".badge-offer")).toHaveText("offer");
});

test("create a posting under an existing name in a different case reuses it", async ({
  page,
}) => {
  // Current Acme posting count (from the seeded DB: our tests added none yet).
  const before = await page.request.get("/api/companies?q=Acme Robotics");
  expect(before.ok()).toBeTruthy();
  const list = (await before.json()) as {
    items: Array<{ id: number; name: string; postingCount: number }>;
  };
  const acme = list.items[0];
  expect(acme).toBeDefined();
  expect(acme.postingCount).toBe(4);

  const titleForAcme = `Case Check ${timestamp()}`;
  await gotoPostings(page);
  await page.locator("body").press("n");
  const dialog = page.locator("dialog[open].modal");
  await dialog.getByLabel("Company").fill("acme robotics");
  await dialog.getByLabel("Title").fill(titleForAcme);
  await dialog.getByLabel("State").selectOption("applied");
  await dialog.locator('button:has-text("Create posting")').click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });

  const after = await page.request.get("/api/companies?q=Acme%20Robotics");
  const listAfter = (await after.json()) as typeof list;
  const sameCompanies = listAfter.items.filter((item) => item.name === "Acme Robotics");
  expect(sameCompanies).toHaveLength(1); // no duplicate company row
  expect(sameCompanies[0].postingCount).toBe(acme.postingCount + 1);

  // Clean up this test's own data.
  const postings = await page.request.get(`/api/postings?q=${encodeURIComponent(titleForAcme)}`);
  const items = (await postings.json()) as { items: Array<{ id: number }> };
  expect(items.items).toHaveLength(1);
  await page.request.delete(`/api/postings/${items.items[0].id}`);
  const restored = await page.request.get("/api/companies?q=Acme%20Robotics");
  const restoredList = (await restored.json()) as typeof list;
  expect(restoredList.items[0].postingCount).toBe(acme.postingCount);
});

test("delete flow with confirm dialog removes the posting", async ({ page }) => {
  await gotoPostings(page);
  await page
    .locator("tbody tr", { hasText: title })
    .first()
    .click();
  const panel = page.locator(".posting-details");
  await panel.locator('button:has-text("Delete")').click();

  const confirm = page.locator("dialog[open].modal", {
    hasText: "Delete posting",
  });
  await expect(confirm).toBeVisible();
  await expect(confirm.locator(".confirm-message")).toContainText(title);
  await expect(confirm.locator(".confirm-message")).toContainText(company);
  await confirm.locator('button:has-text("Cancel")').first().click();
  await expect(confirm).toBeHidden();
  // Posting still there after cancelling.
  await expect(page.locator(".posting-details")).toBeVisible();

  // Now really delete.
  await panel.locator('button:has-text("Delete")').click();
  const confirm2 = page.locator("dialog[open].modal", { hasText: "Delete posting" });
  await confirm2.locator('button:has-text("Delete")').first().click();
  await expect(confirm2).toBeHidden({ timeout: 10_000 });
  await expect(page.locator(".posting-details")).toHaveCount(0);
  await expect(page.locator(`tbody tr:has-text("${title}")`)).toHaveCount(0);
});
