// AI Context tab: one shared, free-form note ("memory for the whole job
// search") that the user and AI assistants both edit.

// Reading goes through react-query (`["context"]`, refetching on window
// focus); every fetched copy is reconciled with the local draft via
// decideOnRefetch (pure logic in ../contextState.ts): a clean draft silently
// adopts newer server content, a dirty draft raises the conflict banner
// instead. Saving uses the optimistic-concurrency token (the last known
// `updatedAt`), so overwriting someone else's edit requires an explicit
// "Overwrite anyway" through a 409 conflict. Ctrl/Cmd+S in the textarea
// saves; the browser warns before leaving while the draft is dirty.

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ContextNote } from "../api";
import { ApiError, getContext, updateContext } from "../api";
import { decideOnRefetch, isDirty } from "../contextState";
import type { NavigateFn, RouteParams } from "../hash";

export interface ContextPageProps {
  params: RouteParams;
  navigate: NavigateFn;
}

// The in-progress draft survives switching tabs (pages unmount per tab).
let draftCache: string | null = null;

const SAVED_CONFIRMATION_MS = 2000;
const MAX_CONTENT_LENGTH = 100000; // server-side body limit (schemas.ts)

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message !== "") return error.message;
  return fallback;
}

function isConflict(error: unknown): boolean {
  return error instanceof ApiError && error.code === "CONFLICT" && error.status === 409;
}

export default function ContextPage(_props: ContextPageProps) {
  const queryClient = useQueryClient();

  const contextQuery = useQuery({
    queryKey: ["context"],
    queryFn: getContext,
    refetchOnWindowFocus: true,
  });

  // `draft` is what the textarea shows; `baseline` mirrors the note as it
  // stands on the server: content is what "Revert" restores and updatedAt is
  // the concurrency token for the next save. null until the first load.
  const [draft, setDraft] = useState(() => draftCache ?? "");
  const [baseline, setBaseline] = useState<ContextNote | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savedConfirmation, setSavedConfirmation] = useState(false);

  const dirty = baseline !== null ? isDirty(draft, baseline.content) : false;
  const canSave = dirty && !saving;

  const applyDraft = (value: string) => {
    draftCache = value;
    setDraft(value);
  };

  // Synchronous guard against double submits (rapid Ctrl+S before a
  // re-render can't read fresh state).
  const saveInFlight = useRef(false);

  // Replace the local view wholesale with a server note: used by the initial
  // load, by a silent adoption, by "Load latest" / "Revert". The draft becomes
  // the server content.
  const adoptNote = (note: ContextNote) => {
    applyDraft(note.content);
    setBaseline({ content: note.content, updatedAt: note.updatedAt });
    setConflict(false);
    setActionError(null);
  };

  // "Saved" is a brief confirmation (~2 s), never leaked across unmounts.
  const savedTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(savedTimer.current), []);

  const confirmSaved = () => {
    setSavedConfirmation(true);
    window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSavedConfirmation(false), SAVED_CONFIRMATION_MS);
  };

  // Baseline reset after a successful save. The draft is deliberately left
  // alone: anything typed while the request was in flight stays.
  const applySaved = (saved: ContextNote) => {
    setBaseline(saved);
    // Seed the cache so an immediate follow-up refetch skips the round trip.
    queryClient.setQueryData<ContextNote>(["context"], saved);
    setConflict(false);
    confirmSaved();
  };

  const save = async () => {
    const base = baseline;
    if (base === null || saveInFlight.current || !dirty || saving) return;
    saveInFlight.current = true;
    setSaving(true);
    setActionError(null);
    setSavedConfirmation(false);
    try {
      const saved = await updateContext(draft, base.updatedAt);
      applySaved(saved);
    } catch (error) {
      if (isConflict(error)) {
        // The stored note changed since we loaded it — keep the draft and let
        // the banner offer the two ways out.
        setConflict(true);
      } else {
        setActionError(messageOf(error, "Failed to save the note."));
      }
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  };

  // Banner choice 2: re-read the stored updatedAt right before overwriting
  // (the whole point of the action is to clobber whatever is stored now),
  // keeping the draft exactly as shown.
  const overwriteAnyway = async () => {
    if (saveInFlight.current) return;
    saveInFlight.current = true;
    setSaving(true);
    setActionError(null);
    setSavedConfirmation(false);
    try {
      const latest = await getContext();
      applySaved(await updateContext(draft, latest.updatedAt));
    } catch (error) {
      if (isConflict(error)) {
        // Raced again between reading `latest` and writing — the banner stays.
        setConflict(true);
      } else {
        setActionError(messageOf(error, "Failed to save the note."));
      }
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  };

  // Banner choice 1 and "Revert": discard the draft and take the newest
  // server content (falling back to the cached copy when the read fails).
  const takeLatest = async () => {
    setActionError(null);
    const result = await contextQuery.refetch();
    if (result.isError) {
      if (result.data !== undefined) adoptNote(result.data);
      setActionError(
        result.error instanceof Error ? result.error.message : "Failed to load the latest note.",
      );
      return;
    }
    const note = result.data;
    if (note === undefined) return;
    adoptNote(note);
  };

  const handleSave = () => {
    if (!canSave) return;
    void save();
  };

  // Ctrl/Cmd+S inside the textarea saves instead of opening the browser's own
  // "save page" dialog.
  const onTextareaKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    if (event.key.toLowerCase() !== "s") return;
    event.preventDefault();
    if (canSave) void save();
  };

  // Reconcile every newly-arrived server note (initial load or a background
  // refetch on window focus) with the draft. takeLatest() refetches too but
  // adopts its result directly, so the dirty check stays out of its way.
  useEffect(() => {
    const note = contextQuery.data;
    if (note === undefined) return;
    if (baseline === null) {
      setBaseline({ content: note.content, updatedAt: note.updatedAt });
      // Only seed the draft on first use; a remembered draft (from before a
      // tab switch) must survive the reconcile — "Revert" still recovers it.
      if (draftCache === null) adoptNote(note);
      return;
    }

    const decision = decideOnRefetch({
      dirty: isDirty(draft, baseline.content),
      baselineUpdatedAt: baseline.updatedAt,
      serverUpdatedAt: note.updatedAt,
    });
    if (decision === "adopt") {
      adoptNote(note);
    } else if (decision === "warn") {
      setConflict(true);
    }
  }, [contextQuery.data, draft, baseline]);

  // Warn (Chromium honours preventDefault, legacy Firefox needs returnValue)
  // before losing unsaved edits to a tab close/refresh while dirty.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const loaded = contextQuery.data !== undefined;
  const updatedAt = contextQuery.data?.updatedAt ?? baseline?.updatedAt ?? "";

  if (!loaded) {
    return (
      <div className="context-page">
        <h2 className="context-heading">AI Context</h2>
        <p className="context-intro">
          Shared memory for the whole job search. AI assistants read it at the start of a session
          and update it when something durable changes.
        </p>
        {contextQuery.isPending ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <p className="form-message error">
              {contextQuery.error instanceof Error
                ? contextQuery.error.message
                : "Failed to load the note."}
            </p>
            <div className="context-actions">
              <button
                type="button"
                className="button-ghost"
                onClick={() => void contextQuery.refetch()}
              >
                Retry
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="context-page">
      <h2 className="context-heading">AI Context</h2>
      <p className="context-intro">
        Shared memory for the whole job search. AI assistants read it at the start of a session
        and update it when something durable changes.
      </p>

      {conflict && (
        <div className="banner-warning" role="alert">
          <p>This note was changed elsewhere (probably by an AI assistant) since you loaded it.</p>
          <div className="banner-actions">
            <button
              type="button"
              className="button-ghost"
              disabled={saving}
              onClick={() => void takeLatest()}
            >
              Load latest (discard my edits)
            </button>
            <button
              type="button"
              className="button"
              disabled={saving}
              onClick={() => void overwriteAnyway()}
            >
              Overwrite anyway
            </button>
          </div>
        </div>
      )}

      {actionError && <p className="form-message error">{actionError}</p>}

      <textarea
        className="context-textarea"
        value={draft}
        onChange={(event) => applyDraft(event.target.value)}
        onKeyDown={onTextareaKeyDown}
        spellCheck={false}
        aria-label="AI context note"
        placeholder="Write durable context for you and your AI assistants…"
        maxLength={MAX_CONTENT_LENGTH}
      />

      <div className="context-actions">
        <button type="button" className="button" onClick={handleSave} disabled={!canSave}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className="button-ghost"
          onClick={() => void takeLatest()}
          disabled={!dirty || saving}
        >
          Revert
        </button>
        <p className="status-line" aria-live="polite">
          <span>Last saved {formatTimestamp(updatedAt)}</span>
          {saving && <span>Saving…</span>}
          {dirty ? <span className="status-dirty">Unsaved changes</span> : null}
          {!dirty && savedConfirmation ? <span className="status-saved">Saved</span> : null}
        </p>
      </div>
    </div>
  );
}
