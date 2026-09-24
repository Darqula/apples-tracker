// Debounced search input. Types update the visible draft immediately; the
// parent's onChange fires 250 ms after typing stops. The global `/` shortcut
// focuses the input whenever no other input is focused.

import { useEffect, useRef, useState } from "react";

const DEBOUNCE_MS = 250;

export interface SearchBoxProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export default function SearchBox({ value, onChange, placeholder }: SearchBoxProps) {
  const [draft, setDraft] = useState(value);
  // The last value we already reported to (or adopted from) the parent.
  const committedRef = useRef(value);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the latest onChange without re-arming the debounce timer on every
  // parent render (the callback may not be memoized).
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  // Adopt external value changes that we did not cause ourselves (e.g. the
  // route restored a different `q`); avoid reverting a pending draft.
  useEffect(() => {
    if (value !== committedRef.current) {
      committedRef.current = value;
      setDraft(value);
    }
  }, [value]);

  // Debounced commit.
  useEffect(() => {
    if (draft === committedRef.current) return;
    const timer = window.setTimeout(() => {
      committedRef.current = draft;
      onChangeRef.current(draft);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [draft]);

  // Global "/" focuses the search input unless the user is already typing.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/") return;
      const target = event.target as HTMLElement | null;
      const alreadyTyping =
        target !== null &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (alreadyTyping) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const clear = () => {
    committedRef.current = "";
    setDraft("");
    onChangeRef.current("");
  };

  return (
    <div className="search-box">
      <input
        ref={inputRef}
        type="search"
        value={draft}
        placeholder={placeholder}
        aria-label={placeholder ?? "Search"}
        onChange={(event) => setDraft(event.target.value)}
      />
      {draft.length > 0 && (
        <button
          type="button"
          className="search-clear"
          aria-label="Clear search"
          onClick={clear}
          onMouseDown={(event) => event.preventDefault()}
        >
          ×
        </button>
      )}
      <span className="search-hint" aria-hidden="true">
        /
      </span>
    </div>
  );
}
