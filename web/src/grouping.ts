// Pure grouping logic for the Postings tab — no React, fully testable.
//
// Client-side grouping sits on top of the server-sorted list ("stage" sort).
// `groupPostings` re-sorts within each group so the row order is stable
// regardless of what order the server returned the rows in.

import type { Posting, State } from "./api";
import { STAGE_ORDER } from "./api";

export type GroupBy = "none" | "company" | "state";

export interface PostingGroup {
  key: string;
  label: string;
  postings: Posting[];
}

// Within-group order: appliedDate desc (nulls last), then title
// (case-insensitive), then id as a stable tiebreaker.
export function comparePostings(a: Posting, b: Posting): number {
  const aDate = a.appliedDate;
  const bDate = b.appliedDate;
  if (aDate === null && bDate === null) {
    // fall through to title
  } else if (aDate === null) {
    return 1; // nulls last
  } else if (bDate === null) {
    return -1;
  } else if (aDate !== bDate) {
    return aDate < bDate ? 1 : -1;
  }

  const byTitle = a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
  if (byTitle !== 0) return byTitle;
  return a.id - b.id;
}

function sortByApplied(postings: Posting[]): Posting[] {
  return [...postings].sort(comparePostings);
}

function capFirst(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toUpperCase() + text.slice(1);
}

// Group postings by company, state, or nothing. Company/state groups never
// come out empty and empty input produces no groups at all.
export function groupPostings(postings: Posting[], groupBy: GroupBy): PostingGroup[] {
  if (postings.length === 0) return [];

  if (groupBy === "none") {
    return [{ key: "all", label: "All postings", postings: sortByApplied(postings) }];
  }

  if (groupBy === "company") {
    const byCompany = new Map<number, Posting[]>();
    for (const posting of postings) {
      const bucket = byCompany.get(posting.companyId);
      if (bucket === undefined) {
        byCompany.set(posting.companyId, [posting]);
      } else {
        bucket.push(posting);
      }
    }

    const groups: Array<{ companyId: number; name: string; postings: Posting[] }> = [];
    for (const [companyId, entries] of byCompany) {
      groups.push({ companyId, name: entries[0].company.name, postings: entries });
    }

    if (groups.length === 0) return [];
    groups.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    return groups.map((group) => ({
      key: `company:${group.companyId}`,
      label: group.name,
      postings: sortByApplied(group.postings),
    }));
  }

  const byState = new Map<State, Posting[]>();
  for (const posting of postings) {
    const bucket = byState.get(posting.state);
    if (bucket === undefined) {
      byState.set(posting.state, [posting]);
    } else {
      bucket.push(posting);
    }
  }

  if (byState.size === 0) return [];
  return STAGE_ORDER.filter((state) => byState.has(state)).map((state) => ({
    key: `state:${state}`,
    label: capFirst(state),
    postings: sortByApplied(byState.get(state) as Posting[]),
  }));
}
