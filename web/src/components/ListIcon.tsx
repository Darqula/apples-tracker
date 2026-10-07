// Small marker shown in a table row when the item belongs to at least one
// list. The native tooltip (title) lists the names, one per line.

import type { ListRef } from "../api";

export interface ListIconProps {
  lists: ListRef[];
}

export default function ListIcon({ lists }: ListIconProps) {
  if (lists.length === 0) return null;
  const names = lists.map((list) => list.name);
  return (
    <span
      className="list-icon"
      role="img"
      aria-label={`Lists: ${names.join(", ")}`}
      title={names.join("\n")}
      data-testid="list-icon"
    >
      ☰
    </span>
  );
}
