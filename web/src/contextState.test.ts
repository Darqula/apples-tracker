import { describe, expect, it } from "vitest";
import { decideOnRefetch, isDirty } from "./contextState";

const EARLIER = "2026-09-24T09:00:00.000Z";
const LATER = "2026-09-24T10:30:00.000Z";

describe("isDirty", () => {
  it("reports clean for content equal to the baseline", () => {
    expect(isDirty("Target: senior frontend roles", "Target: senior frontend roles")).toBe(false);
    expect(isDirty("", "")).toBe(false);
  });

  it("reports dirty for different content, including whitespace-only edits", () => {
    expect(isDirty("Target: senior roles", "Target: senior frontend roles")).toBe(true);
    expect(isDirty("baseline ", "baseline")).toBe(true);
    expect(isDirty("", "baseline")).toBe(true);
  });
});

describe("decideOnRefetch", () => {
  it("ignores a refetch whose updatedAt equals the baseline, dirty or not", () => {
    expect(
      decideOnRefetch({ dirty: false, baselineUpdatedAt: LATER, serverUpdatedAt: LATER }),
    ).toBe("ignore");
    expect(
      decideOnRefetch({ dirty: true, baselineUpdatedAt: LATER, serverUpdatedAt: LATER }),
    ).toBe("ignore");
  });

  it("silently adopts newer server content when the draft is clean", () => {
    expect(
      decideOnRefetch({ dirty: false, baselineUpdatedAt: EARLIER, serverUpdatedAt: LATER }),
    ).toBe("adopt");
  });

  it("warns instead of touching the draft when a newer refetch arrives while dirty", () => {
    expect(
      decideOnRefetch({ dirty: true, baselineUpdatedAt: EARLIER, serverUpdatedAt: LATER }),
    ).toBe("warn");
  });

  it("ignores an older server updatedAt (stale refetch response)", () => {
    expect(
      decideOnRefetch({ dirty: false, baselineUpdatedAt: LATER, serverUpdatedAt: EARLIER }),
    ).toBe("ignore");
    expect(
      decideOnRefetch({ dirty: true, baselineUpdatedAt: LATER, serverUpdatedAt: EARLIER }),
    ).toBe("ignore");
  });
});
