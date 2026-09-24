import { describe, expect, it } from "vitest";
import type { Posting, State } from "./api";
import { STAGE_ORDER } from "./api";
import { groupPostings, type GroupBy } from "./grouping";

let nextId = 1;

// Minimal Posting builder — grouping only touches company/state/date/title/id.
function makePosting(overrides: Partial<Posting> = {}): Posting {
  const id = overrides.id ?? nextId++;
  return {
    id,
    companyId: overrides.companyId ?? 1,
    company: overrides.company ?? { id: overrides.companyId ?? 1, name: "Company" },
    title: overrides.title ?? `Title ${id}`,
    state: overrides.state ?? "applied",
    appliedDate: overrides.appliedDate ?? null,
    description: "",
    aiContext: "",
    urls: [],
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

const states: State[] = [
  "offer",
  "interview",
  "screening",
  "applied",
  "saved",
  "rejected",
  "withdrawn",
  "ghosted",
];

describe("groupPostings — none", () => {
  it("returns a single group holding every posting", () => {
    const postings = [makePosting(), makePosting({ companyId: 2 })];
    const groups = groupPostings(postings, "none");
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: "all", label: "All postings" });
    expect(groups[0].postings).toHaveLength(2);
  });

  it("returns no groups for empty input", () => {
    expect(groupPostings([], "none")).toEqual([]);
  });
});

describe("groupPostings — company", () => {
  it("sorts groups by company name case-insensitively A→Z", () => {
    const postings = [
      makePosting({ companyId: 1, company: { id: 1, name: "beta" } }),
      makePosting({ companyId: 2, company: { id: 2, name: "Alpha" } }),
      makePosting({ companyId: 3, company: { id: 3, name: "Gamma" } }),
    ];
    const groups = groupPostings(postings, "company");
    expect(groups.map((group) => group.label)).toEqual(["Alpha", "beta", "Gamma"]);
    expect(groups.map((group) => group.key)).toEqual(["company:2", "company:1", "company:3"]);
  });

  it("sorts groups case-insensitively and never returns empty groups", () => {
    // Same company id repeated — only one group for it, plus mixed case names.
    const postings = [
      makePosting({ companyId: 2, company: { id: 2, name: "gamma" } }),
      makePosting({ companyId: 1, company: { id: 1, name: "Beta" } }),
      makePosting({ companyId: 3, company: { id: 3, name: "alpha" } }),
      makePosting({ companyId: 1, company: { id: 1, name: "Beta" } }),
    ];
    const groups = groupPostings(postings, "company");
    expect(groups.map((group) => group.label)).toEqual(["alpha", "Beta", "gamma"]);
    expect(groups.map((group) => group.postings.length)).toEqual([1, 2, 1]);
  });

  it("returns no groups for empty input", () => {
    expect(groupPostings([], "company")).toEqual([]);
  });
});

describe("groupPostings — state", () => {
  it("orders groups by STAGE_ORDER regardless of input order and omits empty states", () => {
    // Deliberately reversed input order.
    const reversed = [...states];
    reversed.reverse();
    const postings = reversed.map((state, index) =>
      makePosting({ id: index + 1, companyId: index + 1, company: { id: index + 1, name: `C${index}` }, state }),
    );
    // Drop one state so it is empty and must be omitted.
    const filtered = postings.filter((posting) => posting.state !== "withdrawn");

    const groups = groupPostings(filtered, "state");
    const expected = STAGE_ORDER.filter((state) => state !== "withdrawn");
    expect(groups.map((group) => group.key)).toEqual(expected.map((state) => `state:${state}`));
  });

  it("includes one group per state present, in stage order", () => {
    const postings = [
      makePosting({ state: "applied" }),
      makePosting({ state: "offer" }),
    ];
    const groups = groupPostings(postings, "state");
    expect(groups.map((group) => group.label)).toEqual(["Offer", "Applied"]);
  });

  it("returns no groups for empty input", () => {
    expect(groupPostings([], "state")).toEqual([]);
  });
});

describe("within-group ordering", () => {
  it("sorts by appliedDate desc inside every group", () => {
    const postingNew = makePosting({ id: 1, state: "applied", appliedDate: "2026-09-10" });
    const postingOld = makePosting({ id: 2, state: "applied", appliedDate: "2026-08-01" });
    const postingHalf = makePosting({ id: 3, state: "applied", appliedDate: "2026-09-01" });

    const groups = groupPostings([postingOld, postingNew, postingHalf], "state");
    expect(groups).toHaveLength(1);
    expect(groups[0].postings.map((posting) => posting.id)).toEqual([1, 3, 2]);
  });

  it("places null appliedDates last", () => {
    const postingDated = makePosting({ id: 1, state: "saved", appliedDate: "2026-01-01" });
    const postingNull = makePosting({ id: 2, state: "saved", appliedDate: null });

    for (const groupBy of ["none", "company", "state"] as const satisfies readonly GroupBy[]) {
      const groups = groupPostings([postingNull, postingDated], groupBy);
      expect(groups).toHaveLength(1);
      expect(groups[0].postings.map((posting) => posting.id)).toEqual([1, 2]);
    }
  });

  it("breaks base-equal title ties by id, and orders ties case-insensitively", () => {
    const id1 = makePosting({ id: 1, state: "saved", title: "apple" });
    const id2 = makePosting({ id: 2, state: "saved", title: "APPLE" });
    const id4 = makePosting({ id: 4, state: "saved", title: "SAME TITLE" });
    const id9 = makePosting({ id: 9, state: "saved", title: "same title" });

    const groups = groupPostings([id1, id2, id9, id4], "none");
    expect(groups).toHaveLength(1);
    // "apple"/"APPLE" are equal at base sensitivity → id order; "same title"
    // pair likewise. "apple" sorts before "same title" case-insensitively.
    expect(groups[0].postings.map((posting) => posting.id)).toEqual([1, 2, 4, 9]);
  });
});
