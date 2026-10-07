// Mutating tests: company and posting lists (manage, assign, icon tooltip, filter, delete).
import { expect, test, type Page } from "@playwright/test";
import { gotoPostings, timestamp } from "./helpers";

const stamp = timestamp();
const companyName = `E2E Lists Co ${stamp}`;
const companyList = `E2E Contractors ${stamp}`;
const postingList = `E2E Dream jobs ${stamp}`;
const title = `E2E List Role ${stamp}`;

async function addList(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "Manage lists" }).click();
  const dialog = page.locator("dialog[open].modal").last();
  await dialog.getByLabel("New list name").fill(name);
  await dialog.getByRole("button", { name: "Add list" }).click();
  await expect(dialog.locator("[data-testid=manage-list-row]", { hasText: name })).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(page.locator("dialog[open].modal")).toHaveCount(0);
}

test("create a company list and put a new company into it", async ({ page }) => {
  await gotoPostings(page);
  await page.locator('.tab-button:has-text("Companies")').click();
  await addList(page, companyList);

  await page.locator('button:has-text("New company")').click();
  const dialog = page.locator("dialog[open].modal");
  await dialog.getByLabel("Name").fill(companyName);
  await dialog.getByLabel(companyList).check();
  await dialog.locator('button:has-text("Create company")').click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });

  const row = page.locator("tbody tr", { hasText: companyName });
  await expect(row.getByTestId("list-icon")).toHaveAttribute("title", companyList);
  await expect(page.locator(".company-details")).toContainText(companyList);
});

test("filter companies by list", async ({ page }) => {
  await gotoPostings(page);
  await page.locator('.tab-button:has-text("Companies")').click();
  await page.locator(".list-filter-field select").selectOption({ label: `${companyList} (1)` });
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr", { hasText: companyName })).toBeVisible();

  // The filter lives in the hash, so it survives a reload.
  await page.reload();
  await expect(page.locator("tbody tr")).toHaveCount(1);

  await page.locator(".list-filter-field select").selectOption({ label: "All" });
  await expect(page.locator("tbody tr")).not.toHaveCount(1);
});

test("posting list: assign on create, icon, filter", async ({ page }) => {
  await gotoPostings(page);
  await addList(page, postingList);

  await page.locator('button:has-text("New posting")').click();
  const dialog = page.locator("dialog[open].modal");
  await dialog.getByLabel("Company").fill(companyName);
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByLabel(postingList).check();
  await dialog.locator('button:has-text("Create posting")').click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });

  const row = page.locator("tbody tr", { hasText: title });
  await expect(row.getByTestId("list-icon")).toHaveAttribute("title", postingList);

  await page.locator(".list-filter-field select").selectOption({ label: `${postingList} (1)` });
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr", { hasText: title })).toBeVisible();
});

test("an item can be in several lists and the tooltip shows one list per line", async ({ page }) => {
  await gotoPostings(page);
  await page.locator('.tab-button:has-text("Companies")').click();
  const second = `E2E Never consider ${stamp}`;
  await addList(page, second);

  await page.locator("tbody tr", { hasText: companyName }).click();
  await page.locator(".company-details").getByRole("button", { name: "Edit" }).click();
  const dialog = page.locator("dialog[open].modal");
  await dialog.getByLabel(second).check();
  await dialog.locator('button:has-text("Save changes")').click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });

  const icon = page.locator("tbody tr", { hasText: companyName }).getByTestId("list-icon");
  // Sorted by name: "E2E Contractors…" before "E2E Never consider…".
  await expect(icon).toHaveAttribute("title", `${companyList}\n${second}`);
});

test("deleting a list keeps its companies and postings", async ({ page }) => {
  await gotoPostings(page);
  await page.getByRole("button", { name: "Manage lists" }).click();
  const manage = page.locator("dialog[open].modal").last();
  await manage.getByRole("button", { name: `Delete list ${postingList}` }).click();
  await page.locator("dialog[open].modal").last().getByRole("button", { name: "Delete list" }).click();
  await expect(manage.locator("[data-testid=manage-list-row]", { hasText: postingList })).toHaveCount(0);
  await manage.getByRole("button", { name: "Close" }).click();

  // The posting is still there, just without the icon.
  const row = page.locator("tbody tr", { hasText: title });
  await expect(row).toBeVisible();
  await expect(row.getByTestId("list-icon")).toHaveCount(0);
});

test("API: company is removed from lists when deleted, the list stays", async ({ request }) => {
  const list = await (await request.post("/api/company-lists", { data: { name: `E2E API list ${stamp}` } })).json();
  const company = await (
    await request.post("/api/companies", { data: { name: `E2E API Co ${stamp}`, listIds: [list.id] } })
  ).json();
  expect((await request.delete(`/api/companies/${company.id}`)).status()).toBe(204);
  const lists = await (await request.get("/api/company-lists")).json();
  const kept = lists.items.find((item: { id: number }) => item.id === list.id);
  expect(kept.memberCount).toBe(0);
});
