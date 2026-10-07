import { useQuery, type QueryClient } from "@tanstack/react-query";
import { listLists, type ListKind } from "../api";

/** All lists of one kind, sorted by name by the server. */
export function useLists(kind: ListKind) {
  return useQuery({
    queryKey: ["lists", kind],
    queryFn: () => listLists(kind),
  });
}

/**
 * Parses the `listId` hash param. Returns null when it is absent or invalid,
 * and also when the lists have loaded and the id no longer exists (a deleted
 * list in an old link must not leave the table filtered to nothing).
 */
export function resolveListFilter(
  param: string | undefined,
  lists: ReadonlyArray<{ id: number }> | undefined,
): number | null {
  if (param === undefined || param === "") return null;
  const id = Number(param);
  if (!Number.isInteger(id) || id <= 0) return null;
  if (lists !== undefined && !lists.some((list) => list.id === id)) return null;
  return id;
}

/** Refreshes everything that embeds list names or counts. */
export function invalidateListQueries(client: QueryClient): Promise<unknown> {
  return Promise.all([
    client.invalidateQueries({ queryKey: ["lists"] }),
    client.invalidateQueries({ queryKey: ["companies"] }),
    client.invalidateQueries({ queryKey: ["company"] }),
    client.invalidateQueries({ queryKey: ["postings"] }),
  ]);
}
