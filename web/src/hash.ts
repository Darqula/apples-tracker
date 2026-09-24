// Tiny hash router: state lives in location.hash as "#/<tab>?key=value&...".
// URLSearchParams does the encoding/decoding, so `q` values survive round
// trips even when they contain spaces, "&" or "/".

import { useCallback, useEffect, useState } from "react";

export type Tab = "postings" | "companies" | "context";

const TABS: readonly string[] = ["postings", "companies", "context"];
const DEFAULT_TAB: Tab = "postings";

export type RouteParams = Record<string, string>;

export interface HashRoute {
  tab: Tab;
  params: RouteParams;
}

// Pure helpers take the raw hash string; the hook below is the only place that
// touches window.location. (Keeps parseHash/buildHash testable without DOM.)

export function parseHash(hash: string): HashRoute {
  // Accept "anything#/tab?query", "#/tab?query" and the bare "/tab?query" too.
  let value = hash.replace(/^.*#\/?/, "");
  const queryStart = value.indexOf("?");
  let query = "";
  if (queryStart !== -1) {
    query = value.slice(queryStart + 1);
    value = value.slice(0, queryStart);
  }

  const tab = (TABS as readonly string[]).includes(value) ? (value as Tab) : DEFAULT_TAB;

  const params: RouteParams = {};
  if (query !== "") {
    for (const [key, param] of new URLSearchParams(query).entries()) {
      params[key] = param;
    }
  }

  return { tab, params };
}

export function buildHash(tab: Tab, params: RouteParams = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === "") continue; // omit empty params
    search.set(key, value);
  }
  const qs = search.toString();
  return `#/${tab}${qs ? `?${qs}` : ""}`;
}

export interface NavigateOptions {
  /** Use history.replaceState instead of pushing a new history entry. */
  replace?: boolean;
}

export type NavigateFn = (
  tab: Tab,
  params?: RouteParams,
  options?: NavigateOptions,
) => void;

export function useHashRoute(): [HashRoute, NavigateFn] {
  const [route, setRoute] = useState<HashRoute>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const navigate = useCallback<NavigateFn>((tab, params = {}, options) => {
    const next = buildHash(tab, params);

    if (options?.replace) {
      // replaceState does not fire hashchange, so update the state ourselves.
      if (window.location.hash !== next) {
        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}${window.location.search}${next}`,
        );
      }
      setRoute(parseHash(next));
    } else if (window.location.hash !== next) {
      window.location.hash = next; // fires hashchange
    } else {
      setRoute(parseHash(next));
    }
  }, []);

  return [route, navigate];
}
