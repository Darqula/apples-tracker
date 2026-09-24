// Small reusable global-keydown hook: fires the handler when the given key
// is pressed, unless the event has modifier keys or originates from an
// editable element (input/textarea/select/contenteditable) or an open
// native <dialog>. Enabled by default.

import { useEffect, useRef } from "react";

export function useHotkey(key: string, handler: () => void, enabled = true): void {
  // Keep the latest handler without re-binding the listener each render.
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== key) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const target = event.target as HTMLElement | null;
      if (
        target !== null &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable ||
          target.closest("dialog[open]") !== null)
      ) {
        return;
      }

      event.preventDefault();
      handlerRef.current();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [key, enabled]);
}
