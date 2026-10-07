// Multi-select of the existing lists (checkboxes) used inside the company and
// posting forms. Creating/renaming lists happens in the Manage lists dialog.

import type { ListItem } from "../api";

export interface ListPickerProps {
  lists: ListItem[];
  selected: number[];
  onChange: (ids: number[]) => void;
  disabled?: boolean;
}

export default function ListPicker({ lists, selected, onChange, disabled = false }: ListPickerProps) {
  const toggle = (id: number, checked: boolean) => {
    onChange(checked ? [...selected, id] : selected.filter((existing) => existing !== id));
  };

  return (
    <fieldset className="form-field list-picker" disabled={disabled}>
      <legend className="form-field-label">Lists</legend>
      {lists.length === 0 ? (
        <span className="form-hint">No lists yet — create one with “Manage lists” in the toolbar.</span>
      ) : (
        <div className="list-picker-options">
          {lists.map((list) => (
            <label key={list.id} className="list-picker-option">
              <input
                type="checkbox"
                checked={selected.includes(list.id)}
                onChange={(event) => toggle(list.id, event.target.checked)}
              />
              <span>{list.name}</span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}
