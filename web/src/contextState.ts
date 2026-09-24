// Pure decision logic for the AI Context editor — no React, no I/O — so it
// stays trivially testable (see contextState.test.ts).

export type RefetchDecision = "ignore" | "adopt" | "warn";

/** True when the editor draft differs from the last loaded/saved content. */
export function isDirty(draft: string, baselineContent: string): boolean {
  return draft !== baselineContent;
}

// SQLite emits fixed-width ISO timestamps ("2026-09-24T12:34:56.789Z"), so
// they would compare correctly as plain strings — but parse them anyway so
// mixed formats (e.g. missing milliseconds) still compare by instant.
function compareIso(a: string, b: string): number {
  const timeA = Date.parse(a);
  const timeB = Date.parse(b);
  if (Number.isNaN(timeA) || Number.isNaN(timeB) || timeA === timeB) {
    if (a === b) return 0;
    return a < b ? -1 : 1;
  }
  return timeA < timeB ? -1 : 1;
}

/**
 * What to do with server data that react-query just fetched (initial load or
 * a background refetch, e.g. on window focus):
 * - "ignore": nothing new for us (same or older updatedAt than the baseline).
 * - "adopt": the server moved on and the editor is clean — take the new copy.
 * - "warn": the server moved on while the user has unsaved edits — surface a
 *   conflict instead of touching the draft.
 */
export function decideOnRefetch(args: {
  dirty: boolean;
  baselineUpdatedAt: string;
  serverUpdatedAt: string;
}): RefetchDecision {
  if (args.serverUpdatedAt === args.baselineUpdatedAt) return "ignore";
  const newer = compareIso(args.serverUpdatedAt, args.baselineUpdatedAt) > 0;
  if (!newer) return "ignore";
  return args.dirty ? "warn" : "adopt";
}
