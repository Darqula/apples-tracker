// Read-only tests against the seeded DB (must stay first, alphabetical order).
import { expect, test } from "@playwright/test";
import { gotoPostings, screenshot } from "./helpers";

const SEEDED_NOTE_START = "# Job search context";

test("app loads with Apples Tracker title and API ok status", async ({ page }) => {
  await gotoPostings(page);
  await expect(page.locator(".app-title")).toHaveText("Apples Tracker");
  await expect(page.locator(".api-status")).toHaveClass(/ok/, { timeout: 10_000 });
  await expect(page.locator(".api-status")).toHaveText("API: ok");
});

test("Postings is the default tab and shows the seeded count", async ({ page }) => {
  await gotoPostings(page);
  await expect(page.locator('.tab-button:has-text("Postings")')).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.locator(".page-count")).toHaveText("14 postings");
});

test("default grouping is State; headers follow stage order (Offer first)", async ({
  page,
}) => {
  await gotoPostings(page);
  // State option is active by default (Group by = State button pressed).
  await expect(page.locator('.segmented-button:has-text("State")')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const labels = await page.locator(".group-header .group-label").allTextContents();
  expect(labels).toEqual([
    "Offer",
    "Interview",
    "Screening",
    "Applied",
    "Saved",
    "Rejected",
    "Withdrawn",
    "Ghosted",
  ]);
  await screenshot(page, "postings-by-state.png");
});

test("switching Group by to Company yields alphabetically sorted headers", async ({
  page,
}) => {
  await gotoPostings(page);
  await page.locator('.segmented-button:has-text("Company")').click();
  const labels = await page.locator(".group-header .group-label").allTextContents();
  const sorted = [...labels].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
  expect(labels).toEqual(sorted);
  expect(labels[0]).toBe("Acme Robotics");
  await screenshot(page, "postings-by-company.png");
});

test("Group by None shows a single table with no group headers", async ({ page }) => {
  await gotoPostings(page);
  await page.locator('.segmented-button:has-text("None")').click();
  await expect(page.locator(".group-header")).toHaveCount(0);
  // Type + company + a few seeded rows are all in one table.
  await expect(page.locator(".table-wrap tbody tr")).toHaveCount(14);
});

test("collapsing a group hides its table and flips aria-expanded", async ({ page }) => {
  await gotoPostings(page);
  const header = page.locator(".group-header").first();
  await expect(header).toHaveAttribute("aria-expanded", "true");
  const before = await page.locator(".table-wrap tbody tr").count();
  expect(before).toBeGreaterThan(0);
  await header.click();
  await expect(header).toHaveAttribute("aria-expanded", "false");
  const after = await page.locator(".table-wrap tbody tr").count();
  expect(after).toBeLessThan(before);
});

test("search filters by job title", async ({ page }) => {
  await gotoPostings(page);
  await page
    .getByRole("searchbox", { name: "Search title or company…" })
    .fill("Senior Backend Engineer");
  // Debounce is 250 ms — wait for the networked result.
  await expect(page.locator(".page-count")).toHaveText("1 posting", { timeout: 10_000 });
  await expect(page.locator("tbody tr").first()).toContainText("Senior Backend Engineer");
});

test("search filters by company name", async ({ page }) => {
  await gotoPostings(page);
  await page.getByRole("searchbox", { name: "Search title or company…" }).fill("Umbrella");
  await expect(page.locator(".page-count")).toHaveText("2 postings", { timeout: 10_000 });
  await expect(page.locator("tbody tr .cell-name").first()).toHaveText("Umbrella Health");
});

test("search does not match description-only text", async ({ page }) => {
  await gotoPostings(page);
  // "telemetry" occurs only in the Senior Backend Engineer description.
  await page.getByRole("searchbox", { name: "Search title or company…" }).fill("telemetry");
  await expect(page.getByText("No postings match the current filters.")).toBeVisible({
    timeout: 10_000,
  });
  // Sanity: the same word exists in a posting description in the unfiltered list.
  await page.getByRole("searchbox", { name: "Search title or company…" }).fill("");
  await expect(page.locator(".page-count")).toHaveText("14 postings", { timeout: 10_000 });
  await expect(page.locator('span[title*="telemetry"]').first()).toBeAttached();
});

test("State select filters to one state", async ({ page }) => {
  await gotoPostings(page);
  await page.locator(".toolbar-field select").selectOption("interview");
  await expect(page.locator(".page-count")).toHaveText("2 postings");
  const badges = await page.locator("tbody .badge").allTextContents();
  for (const badge of badges) {
    expect(badge).toBe("interview");
  }
});

test("Companies tab lists 6 companies and search filters by name", async ({ page }) => {
  await gotoPostings(page);
  await page.locator('.tab-button:has-text("Companies")').click();
  await expect(page.locator(".page-count")).toHaveText("6 companies");
  await page.getByRole("searchbox", { name: "Search companies…" }).fill("Acme");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr").first()).toContainText("Acme Robotics");
});

test("company postings-count link opens Postings with chip and filtered rows", async ({
  page,
}) => {
  await gotoPostings(page);
  await page.locator('.tab-button:has-text("Companies")').click();
  const acmeRow = page.locator("tbody tr", { hasText: "Acme Robotics" });
  await expect(acmeRow).toBeVisible();
  await acmeRow.locator("button.link-button").click();
  // Now on the Postings tab with a chip.
  await expect(page.locator('.tab-button:has-text("Postings")')).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.locator(".filter-chip-label")).toHaveText("Acme Robotics");
  await expect(page.locator(".page-count")).toHaveText("4 postings");
  const companies = await page
    .locator("tbody tr td:first-child .cell-name")
    .allTextContents();
  for (const name of companies) {
    expect(name).toBe("Acme Robotics");
  }
  // × removes the chip and restores the full list.
  await expect(page.locator(".filter-chip-remove")).toBeVisible();
  await page.locator(".filter-chip-remove").click();
  await expect(page.locator(".filter-chip")).toHaveCount(0);
  await expect(page.locator(".page-count")).toHaveText("14 postings");
});

test("clicking a posting's company opens the Companies side panel", async ({ page }) => {
  await gotoPostings(page);
  await page
    .locator("tbody tr", { hasText: "Senior Backend Engineer" })
    .locator('button[title="Open company details"]')
    .click();
  await expect(page.locator('.tab-button:has-text("Companies")')).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.locator(".company-details-name")).toHaveText("Acme Robotics");
  await screenshot(page, "companies-panel.png");
});

test("row click opens posting details with title, state and AI context", async ({ page }) => {
  await gotoPostings(page);
  await page.locator("tbody tr", { hasText: "Senior Backend Engineer" }).first().click();
  const panel = page.locator(".posting-details");
  await expect(panel).toBeVisible();
  await expect(panel.locator(".posting-details-title")).toHaveText("Senior Backend Engineer");
  await expect(page.locator(".side-panel .badge-offer")).toBeVisible();
  await expect(panel.locator(".detail-pre")).toContainText("Jane Doe");
});

test("AI Context tab shows the seeded note", async ({ page }) => {
  await gotoPostings(page);
  await page.locator('.tab-button:has-text("AI Context")').click();
  const textarea = page.locator(".context-textarea");
  await expect(textarea).toBeVisible();
  const value = await textarea.inputValue();
  expect(value.startsWith(SEEDED_NOTE_START)).toBe(true);
  expect(value).toContain("## Target roles");
  await page.waitForTimeout(300); // settle raf/focus
  await screenshot(page, "context.png");
});
