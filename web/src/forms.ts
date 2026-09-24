// Pure helpers shared by the company form UI (no React, so everything is
// unit-testable): parsing the free-text URLs field, mapping between server
// models and form values, validation, and minimal PATCH computation.

import type { Company, CompanyInput, CompanyDetail, Posting, PostingInput, PostingPatch, State } from "./api";

/** Free-text URLs: one per line (blank lines are ignored). */
export interface CompanyFormValues {
  name: string;
  website: string;
  location: string;
  description: string;
  aiContext: string;
  urlsText: string;
}

const HTTP_URL_PATTERN = /^https?:\/\/\S+$/;

// Split on any whitespace so both newline-per-line and space-separated
// entries work; every valid URL is whitespace-free by definition.
export function parseUrlLines(text: string): { urls: string[]; invalid: string[] } {
  const urls: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const entry of text.split(/\s+/)) {
    const value = entry.trim();
    if (value === "") continue;
    if (seen.has(value)) continue;
    seen.add(value);
    if (HTTP_URL_PATTERN.test(value)) {
      urls.push(value);
    } else {
      invalid.push(value);
    }
  }
  return { urls, invalid };
}

// Field name → message. A non-empty result blocks submission.
export function validateCompanyForm(values: CompanyFormValues): Record<string, string> {
  const errors: Record<string, string> = {};

  if (values.name.trim() === "") {
    errors.name = "Name is required.";
  }

  const website = values.website.trim();
  if (website !== "" && !HTTP_URL_PATTERN.test(website)) {
    errors.website = "Website must start with http:// or https://.";
  }

  const { invalid } = parseUrlLines(values.urlsText);
  if (invalid.length > 0) {
    errors.urlsText =
      invalid.length === 1
        ? `Invalid URL: ${invalid[0]}`
        : `${invalid.length} invalid URLs — each one must start with http:// or https://`;
  }

  return errors;
}

export function emptyCompanyForm(): CompanyFormValues {
  return { name: "", website: "", location: "", description: "", aiContext: "", urlsText: "" };
}

export function companyToForm(company: Company | CompanyDetail): CompanyFormValues {
  return {
    name: company.name,
    website: company.website ?? "",
    location: company.location ?? "",
    description: company.description,
    aiContext: company.aiContext,
    urlsText: company.urls.join("\n"),
  };
}

export function companyFormToInput(values: CompanyFormValues): CompanyInput {
  const website = values.website.trim();
  const location = values.location.trim();
  return {
    name: values.name.trim(),
    website: website === "" ? null : website,
    location: location === "" ? null : location,
    description: values.description.trim(),
    aiContext: values.aiContext.trim(),
    urls: parseUrlLines(values.urlsText).urls,
  };
}

// Minimal patch against a server model: only the fields whose (trimmed) value
// changed are included, so an unchanged form produces an empty patch.
export function companyFormToPatch(
  original: Company,
  values: CompanyFormValues,
): Partial<CompanyInput> {
  const input = companyFormToInput(values);
  const patch: Partial<CompanyInput> = {};

  if (input.name !== original.name) patch.name = input.name;
  if (input.website !== original.website) patch.website = input.website;
  if (input.location !== original.location) patch.location = input.location;
  if (input.description !== original.description) patch.description = input.description;
  if (input.aiContext !== original.aiContext) patch.aiContext = input.aiContext;
  if (
    input.urls.length !== original.urls.length ||
    input.urls.some((url, index) => url !== original.urls[index])
  ) {
    patch.urls = input.urls;
  }

  return patch;
}

// ---------------------------------------------------------------------------
// Posting form helpers — same pattern as the company helpers above.
// ---------------------------------------------------------------------------

export interface PostingFormValues {
  companyName: string;
  title: string;
  state: State;
  // 'YYYY-MM-DD' or the empty string (meaning "no applied date").
  appliedDate: string;
  description: string;
  aiContext: string;
  urlsText: string;
}

// Real calendar date: 2026-02-31 would parse as 2026-03-03, so round-trip
// through Date and compare the components to reject it.
export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return false;
  const [year, month, day] = value.split("-").map(Number);
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day
  );
}

export function validatePostingForm(values: PostingFormValues): Record<string, string> {
  const errors: Record<string, string> = {};

  if (values.companyName.trim() === "") {
    errors.companyName = "Company is required.";
  }
  if (values.title.trim() === "") {
    errors.title = "Title is required.";
  }
  const appliedDate = values.appliedDate.trim();
  if (appliedDate !== "" && !isValidIsoDate(appliedDate)) {
    errors.appliedDate = "Applied date must be a real date in YYYY-MM-DD format.";
  }

  const { invalid } = parseUrlLines(values.urlsText);
  if (invalid.length > 0) {
    errors.urlsText =
      invalid.length === 1
        ? `Invalid URL: ${invalid[0]}`
        : `${invalid.length} invalid URLs — each one must start with http:// or https://`;
  }

  return errors;
}

export function emptyPostingForm(
  defaults: { companyName?: string } = {},
): PostingFormValues {
  return {
    companyName: defaults.companyName ?? "",
    title: "",
    state: "saved",
    appliedDate: "",
    description: "",
    aiContext: "",
    urlsText: "",
  };
}

export function postingToForm(posting: Posting): PostingFormValues {
  return {
    companyName: posting.company.name,
    title: posting.title,
    state: posting.state,
    appliedDate: posting.appliedDate ?? "",
    description: posting.description,
    aiContext: posting.aiContext,
    urlsText: posting.urls.join("\n"),
  };
}

/** Trimmed, case-insensitive exact match; undefined when nothing matches. */
export function findCompanyByName(
  companies: ReadonlyArray<{ id: number; name: string }>,
  name: string,
): { id: number; name: string } | undefined {
  const needle = name.trim().toLowerCase();
  if (needle === "") return undefined;
  return companies.find((company) => company.name.trim().toLowerCase() === needle);
}

// Uses the existing company's id when the typed name (trim-
// & case-insensitively) matches one, else asks the server to find-or-create
// by name.
export function postingFormToCreateInput(
  values: PostingFormValues,
  companies: ReadonlyArray<{ id: number; name: string }>,
): PostingInput {
  const existing = findCompanyByName(companies, values.companyName);
  const appliedDate = values.appliedDate.trim();
  return {
    title: values.title.trim(),
    state: values.state,
    appliedDate: appliedDate === "" ? null : appliedDate,
    description: values.description.trim(),
    aiContext: values.aiContext.trim(),
    urls: parseUrlLines(values.urlsText).urls,
    ...(existing !== undefined
      ? { companyId: existing.id }
      : { companyName: values.companyName.trim() }),
  };
}

// Minimal patch against a server posting, resolved against the company id the
// page has settled on (existing match and/or a freshly created company).
// Only fields whose (trimmed) value changed are included, so an unchanged
// form produces an empty patch.
export function postingFormToPatch(
  original: Posting,
  values: PostingFormValues,
  resolvedCompanyId: number,
): PostingPatch {
  const patch: PostingPatch = {};

  const title = values.title.trim();
  if (title !== original.title) patch.title = title;

  if (values.state !== original.state) patch.state = values.state;

  const appliedDate = values.appliedDate.trim();
  if (appliedDate === "" ? original.appliedDate !== null : appliedDate !== original.appliedDate) {
    patch.appliedDate = appliedDate === "" ? null : appliedDate;
  }

  const description = values.description.trim();
  if (description !== original.description) patch.description = description;

  const aiContext = values.aiContext.trim();
  if (aiContext !== original.aiContext) patch.aiContext = aiContext;

  const urls = parseUrlLines(values.urlsText).urls;
  if (
    urls.length !== original.urls.length ||
    urls.some((url, index) => url !== original.urls[index])
  ) {
    patch.urls = urls;
  }

  if (resolvedCompanyId !== original.companyId) patch.companyId = resolvedCompanyId;

  return patch;
}
