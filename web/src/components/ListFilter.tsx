// Toolbar control: a "List" dropdown that filters the table to one list,
// plus a button opening the Manage lists dialog.

import { useState } from "react";
import type { ListItem, ListKind } from "../api";
import ManageListsDialog from "./ManageListsDialog";

export interface ListFilterProps {
  kind: ListKind;
  lists: ListItem[];
  /** Selected list id, or null for "All". */
  value: number | null;
  onChange: (id: number | null) => void;
}

export default function ListFilter({ kind, lists, value, onChange }: ListFilterProps) {
  const [managing, setManaging] = useState(false);

  return (
    <>
      <label className="list-filter-field">
        <span className="toolbar-field-label">List</span>
        <select
          value={value === null ? "" : String(value)}
          onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
        >
          <option value="">All</option>
          {lists.map((list) => (
            <option key={list.id} value={list.id}>
              {list.name} ({list.memberCount})
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="button-ghost" onClick={() => setManaging(true)}>
        Manage lists
      </button>
      {managing && <ManageListsDialog kind={kind} lists={lists} onClose={() => setManaging(false)} />}
    </>
  );
}
