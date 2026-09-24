import { describe, expect, it } from "vitest";
import {
  companyFormToInput,
  companyFormToPatch,
  companyToForm,
  emptyCompanyForm,
  emptyPostingForm,
  findCompanyByName,
  parseUrlLines,
  postingFormToCreateInput,
  postingFormToPatch,
  postingToForm,
  validateCompanyForm,
  validatePostingForm,
} from "./forms";
import type { Company, Posting } from "./api";

const URL_CASES: Array<{ text: string; urls: string[]; invalid: string[] }> = [
  { text: "", urls: [], invalid: [] },
  { text: "https://a.example\nhttps://b.example", urls: ["https://a.example", "https://b.example"], invalid: [] },
  // Blank lines are dropped.
  { text: "https://a.example\n\n  \nhttps://b.example", urls: ["https://a.example", "https://b.example"], invalid: [] },
  // Whitespace-separated entries work too.
  { text: "https://a.example https://b.example", urls: ["https://a.example", "https://b.example"], invalid: [] },
  // Dedupe preserves first-seen order.
  { text: "https://b.example https://a.example https://b.example", urls: ["https://b.example", "https://a.example"], invalid: [] },
  // Leading/trailing whitespace per entry is trimmed.
  { text: "  https://a.example  ", urls: ["https://a.example"], invalid: [] },
  // The scheme decides validity.
  { text: "a.example ftp://a.example", urls: [], invalid: ["a.example", "ftp://a.example"] },
  { text: "http://x.example/path?q=1", urls: ["http://x.example/path?q=1"], invalid: [] },
  // Mixed valid and invalid, all preserved.
  { text: "bad https://a.example", urls: ["https://a.example"], invalid: ["bad"] },
];

describe("parseUrlLines", () => {
  for (const { text, urls, invalid } of URL_CASES) {
    it(`parses ${JSON.stringify(text)}`, () => {
      expect(parseUrlLines(text)).toEqual({ urls, invalid });
    });
  }
});

describe("emptyCompanyForm", () => {
  it("is all empty strings", () => {
    expect(emptyCompanyForm()).toEqual({
      name: "",
      website: "",
      location: "",
      description: "",
      aiContext: "",
      urlsText: "",
    });
  });
});

describe("validateCompanyForm", () => {
  it("accepts the empty form except for the required name", () => {
    expect(validateCompanyForm(emptyCompanyForm())).toEqual({ name: "Name is required." });
  });

  it("accepts a valid form", () => {
    const values = { ...emptyCompanyForm(), name: "Acme", website: "https://acme.example", urlsText: "http://a.example" };
    expect(validateCompanyForm(values)).toEqual({});
  });

  it("checks the website scheme", () => {
    const values = { ...emptyCompanyForm(), name: "Acme", website: "acme.example" };
    expect(validateCompanyForm(values).website).toContain("http");
  });

  it("reports invalid URL lines", () => {
    const values = { ...emptyCompanyForm(), name: "Acme", urlsText: "nope\nhttps://a.example" };
    expect(validateCompanyForm(values).urlsText).toContain("nope");
  });
});

describe("companyFormToInput", () => {
  it("maps empty website/location to null and trims strings", () => {
    const values = { ...emptyCompanyForm(), name: " Acme ", website: "  ", description: " . " };
    expect(companyFormToInput(values)).toEqual({
      name: "Acme",
      website: null,
      location: null,
      description: ".",
      aiContext: "",
      urls: [],
    });
  });

  it("parses the URLs textarea", () => {
    const values = { ...emptyCompanyForm(), name: "Acme", urlsText: "https://a.example\n\nhttps://b.example" };
    expect(companyFormToInput(values).urls).toEqual(["https://a.example", "https://b.example"]);
  });
});

describe("companyFormToPatch", () => {
  const company: Company = {
    id: 1,
    name: "Acme",
    website: "https://acme.example",
    location: "Berlin",
    description: "Widgets",
    aiContext: "notes",
    urls: ["https://a.example", "https://b.example"],
    postingCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("is empty when the form matches the company", () => {
    const patch = companyFormToPatch(company, companyToForm(company));
    expect(patch).toEqual({});
  });

  it("contains only changed fields", () => {
    const patch = companyFormToPatch(company, {
      ...companyToForm(company),
      name: "  New Name  ",
      description: "A changed description",
    });
    expect(patch).toEqual({ name: "New Name", description: "A changed description" });
  });

  it("clears text that became empty via null for nullable fields", () => {
    const patch = companyFormToPatch(company, { ...companyToForm(company), website: "", location: "" });
    expect(patch).toEqual({ website: null, location: null });
  });

  it("sends urls when the list changed", () => {
    const patch = companyFormToPatch(company, { ...companyToForm(company), urlsText: "https://b.example\nhttps://a.example" });
    expect(patch).toEqual({ urls: ["https://b.example", "https://a.example"] });
  });
});

const POSTING: Posting = {
  id: 7,
  companyId: 1,
  company: { id: 1, name: "Acme" },
  title: "Engineer",
  state: "applied",
  appliedDate: "2026-03-01",
  description: "Build widgets",
  aiContext: "notes",
  urls: ["https://a.example", "https://b.example"],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const COMPANIES = [
  { id: 1, name: "Acme" },
  { id: 2, name: "Beta Basics" },
];

describe("emptyPostingForm", () => {
  it("defaults to state 'saved' and no applied date", () => {
    expect(emptyPostingForm()).toEqual({
      companyName: "",
      title: "",
      state: "saved",
      appliedDate: "",
      description: "",
      aiContext: "",
      urlsText: "",
    });
  });

  it("accepts a default company name", () => {
    expect(emptyPostingForm({ companyName: "Acme" }).companyName).toBe("Acme");
  });
});

describe("validatePostingForm", () => {
  it("requires company and title", () => {
    expect(validatePostingForm(emptyPostingForm())).toEqual({
      companyName: "Company is required.",
      title: "Title is required.",
    });
  });

  it("accepts a valid form", () => {
    const values = { ...emptyPostingForm({ companyName: "Acme" }), title: "Engineer", appliedDate: "2026-03-01" };
    expect(validatePostingForm(values)).toEqual({});
  });

  it("rejects malformed dates", () => {
    for (const appliedDate of ["1.2.2026", "2026-3-1", "2026-03"]) {
      const values = { ...emptyPostingForm({ companyName: "Acme" }), title: "T", appliedDate };
      expect(validatePostingForm(values).appliedDate).toBeDefined();
    }
  });

  it("rejects impossible calendar dates like 2026-02-31", () => {
    const values = { ...emptyPostingForm({ companyName: "Acme" }), title: "T", appliedDate: "2026-02-31" };
    expect(validatePostingForm(values).appliedDate).toContain("real date");
  });

  it("reports invalid URL lines", () => {
    const values = { ...emptyPostingForm({ companyName: "Acme" }), title: "T", urlsText: "nope" };
    expect(validatePostingForm(values).urlsText).toContain("nope");
  });
});

describe("findCompanyByName", () => {
  it("matches case-insensitively and trimmed", () => {
    expect(findCompanyByName(COMPANIES, "  ACME  ")).toEqual({ id: 1, name: "Acme" });
    expect(findCompanyByName(COMPANIES, "beta basics")).toEqual({ id: 2, name: "Beta Basics" });
  });

  it("returns undefined for unknown or blank names", () => {
    expect(findCompanyByName(COMPANIES, "Gamma")).toBeUndefined();
    expect(findCompanyByName(COMPANIES, "   ")).toBeUndefined();
  });
});

describe("postingFormToCreateInput", () => {
  it("uses companyId when the typed name matches an existing company", () => {
    const values = { ...emptyPostingForm({ companyName: " acme " }), title: " Engineer " };
    expect(postingFormToCreateInput(values, COMPANIES)).toEqual({
      title: "Engineer",
      state: "saved",
      appliedDate: null,
      description: "",
      aiContext: "",
      urls: [],
      companyId: 1,
    });
  });

  it("uses companyName when no company matches", () => {
    const values = { ...emptyPostingForm({ companyName: "Gamma" }), title: "Engineer" };
    const input = postingFormToCreateInput(values, COMPANIES);
    expect(input).toMatchObject({ companyName: "Gamma", appliedDate: null });
    expect("companyId" in input).toBe(false);
  });

  it("parses urls and keeps a non-empty applied date", () => {
    const values = {
      ...emptyPostingForm({ companyName: "Acme" }),
      title: "T",
      appliedDate: " 2026-03-01 ",
      urlsText: "https://a.example\n\nhttps://b.example",
    };
    expect(postingFormToCreateInput(values, COMPANIES)).toMatchObject({
      appliedDate: "2026-03-01",
      urls: ["https://a.example", "https://b.example"],
    });
  });
});

describe("postingFormToPatch", () => {
  it("is empty when the form matches the posting", () => {
    const patch = postingFormToPatch(POSTING, postingToForm(POSTING), POSTING.companyId);
    expect(patch).toEqual({});
  });

  it("contains only changed fields", () => {
    const patch = postingFormToPatch(POSTING, { ...postingToForm(POSTING), title: "  Senior Engineer  ", state: "interview" }, POSTING.companyId);
    expect(patch).toEqual({ title: "Senior Engineer", state: "interview" });
  });

  it("clears the applied date to null", () => {
    const patch = postingFormToPatch(POSTING, { ...postingToForm(POSTING), appliedDate: "" }, POSTING.companyId);
    expect(patch).toEqual({ appliedDate: null });
  });

  it("adds a real applied date and includes companyId when it changed", () => {
    const values = { ...postingToForm(POSTING), appliedDate: "2026-04-01" };
    const patch = postingFormToPatch(POSTING, values, 2);
    expect(patch).toEqual({ appliedDate: "2026-04-01", companyId: 2 });
  });

  it("compares urls element-wise", () => {
    const patch = postingFormToPatch(POSTING, { ...postingToForm(POSTING), urlsText: "https://b.example\nhttps://a.example" }, POSTING.companyId);
    expect(patch).toEqual({ urls: ["https://b.example", "https://a.example"] });
  });

  it("does not include companyId when it is unchanged", () => {
    const patch = postingFormToPatch(POSTING, postingToForm(POSTING), 1);
    expect(patch).toEqual({});
  });
});
