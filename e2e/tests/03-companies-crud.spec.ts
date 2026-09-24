// Mutating tests: company CRUD.
import { expect, test } from "@playwright/test";
import { gotoPostings, timestamp } from "./helpers";

const name = `E2E Logistics ${timestamp()}`;
const nameLower = name.toLowerCase();

test("create a company with website and URL", async ({ page }) => {
  await gotoPostings(page);
  await page.locator('.tab-button:has-text("Companies")').click();
  await page.locator('button:has-text("New company")').click();
  const dialog = page.locator("dialog[open].modal");
  await expect(dialog.locator(".modal-title")).toHaveText("New company");
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Website").fill("https://e2e-logistics.example");
  await dialog
    .getByLabel(/URLs/)
    .fill("https://e2e-logistics.example/careers");
  await dialog.locator('button:has-text("Create company")').click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });
  // Creation opens the side panel for the new company.
  await expect(page.locator(".company-details-name")).toHaveText(name);
});

test("duplicate name in different case is rejected inline and the modal stays open", async ({
  page,
}) => {
  await gotoPostings(page);
  await page.locator('.tab-button:has-text("Companies")').click();
  await page.locator('button:has-text("New company")').click();
  const dialog = page.locator("dialog[open].modal");
  await dialog.getByLabel("Name").fill(nameLower);
  await dialog.locator('button:has-text("Create company")').click();
  const error = dialog.locator(".form-field-error");
  await expect(error).toBeVisible({ timeout: 10_000 });
  expect((await error.textContent()).length).toBeGreaterThan(0);
  // Modal is still open.
  await expect(dialog).toBeVisible();
});

test("edit a company's location", async ({ page }) => {
  await gotoPostings(page);
  await page.locator('.tab-button:has-text("Companies")').click();
  await page.locator("tbody tr", { hasText: name }).click();
  const panel = page.locator(".company-details");
  await expect(panel).toBeVisible();
  await panel.locator('button:has-text("Edit")').click();
  const dialog = page.locator("dialog[open].modal");
  await dialog.getByLabel("Location").fill("Rotterdam, Netherlands");
  await dialog.locator('button:has-text("Save changes")').click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });
  await expect(panel.locator(".company-details-line", { hasText: "Location:" })).toContainText(
    "Rotterdam, Netherlands",
  );
});

test("deleting a company with postings warns and cascades", async ({ page }) => {
  // Create a posting for the company (server-side, uniquely named).
  const postingTitle = `Cascade Target ${timestamp()}`;
  const createRes = await page.request.post("/api/postings", {
    data: {
      companyName: name,
      title: postingTitle,
      state: "applied",
      appliedDate: "2026-09-10",
      description: "",
      aiContext: "",
      urls: [],
    },
  });
  expect(createRes.ok()).toBeTruthy();

  await gotoPostings(page);
  await page.locator('.tab-button:has-text("Companies")').click();
  await page.locator("tbody tr", { hasText: name }).click();
  const panel = page.locator(".company-details");
  await expect(panel).toBeVisible();

  await panel.locator('button:has-text("Delete")').click();
  const confirm = page.locator("dialog[open].modal", { hasText: "Delete company" });
  await expect(confirm).toBeVisible();
  const message = await confirm.locator(".confirm-message").textContent();
  expect(message).toContain("1 posting");
  expect(message).toContain("permanently delete");

  await confirm.locator('button:has-text("Delete company and 1 posting")').click();
  await expect(confirm).toBeHidden({ timeout: 10_000 });

  // Company row is gone (list re-sorted/new data does not affect: search).
  await page.getByRole("searchbox", { name: "Search companies…" }).fill("E2E Logistics");
  await expect(page.locator(".page-count")).toHaveText("0 companies");

  // Its posting is gone from the Postings tab too.
  await page.locator('.tab-button:has-text("Postings")').click();
  await page
    .getByRole("searchbox", { name: "Search title or company…" })
    .fill(postingTitle);
  await expect(page.getByText("No postings match the current filters.")).toBeVisible({
    timeout: 10_000,
  });
});
