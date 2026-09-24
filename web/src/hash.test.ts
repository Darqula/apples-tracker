import { describe, expect, it } from "vitest";
import { buildHash, parseHash, type Tab } from "./hash";

describe("parseHash", () => {
  it("returns the default route for an empty hash", () => {
    expect(parseHash("")).toEqual({ tab: "postings", params: {} });
  });

  it("falls back to the default tab for an unknown tab, keeping params", () => {
    expect(parseHash("#/nope?x=1")).toEqual({ tab: "postings", params: { x: "1" } });
  });

  it("parses a tab without params", () => {
    expect(parseHash("#/companies")).toEqual({ tab: "companies", params: {} });
  });

  it("parses tab and params", () => {
    expect(parseHash("#/companies?q=acme&selected=12")).toEqual({
      tab: "companies",
      params: { q: "acme", selected: "12" },
    });
  });

  it("decodes percent-encoded and plus-encoded characters", () => {
    expect(parseHash("#/companies?q=hello%20world")).toEqual({
      tab: "companies",
      params: { q: "hello world" },
    });
    expect(parseHash("#/companies?q=a+b")).toEqual({
      tab: "companies",
      params: { q: "a b" },
    });
  });

  it("is lenient about a missing leading slash", () => {
    expect(parseHash("#companies?selected=7")).toEqual({
      tab: "companies",
      params: { selected: "7" },
    });
  });
});

describe("buildHash", () => {
  it("builds a bare tab hash without params", () => {
    expect(buildHash("postings")).toBe("#/postings");
  });

  it("omits empty params", () => {
    expect(buildHash("companies", { q: "", selected: "" })).toBe("#/companies");
    expect(buildHash("companies", { q: "acme", selected: "" })).toBe("#/companies?q=acme");
  });

  it("encodes params so parseHash round-trips them", () => {
    const cases: Array<{ tab: Tab; params: Record<string, string> }> = [
      { tab: "companies" as const, params: {} },
      { tab: "companies" as const, params: { q: "hello world" } },
      { tab: "companies" as const, params: { q: "a&b=c#d" } },
      { tab: "companies" as const, params: { q: "acme+inc", selected: "12" } },
      { tab: "postings" as const, params: { companyId: "3", selected: "9" } },
      { tab: "context" as const, params: { weird: "/spaces & ?symbols" } },
    ];

    for (const { tab, params } of cases) {
      const hash = buildHash(tab, params);
      expect(hash.startsWith(`#/${tab}`)).toBe(true);
      expect(parseHash(hash)).toEqual({ tab, params });
    }
  });
});
