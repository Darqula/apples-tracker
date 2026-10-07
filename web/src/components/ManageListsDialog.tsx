// Dialog for creating, renaming and deleting lists of one kind. Deleting a
// list only removes the list itself; its companies/postings are untouched.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { createList, deleteList, renameList, type ListItem, type ListKind } from "../api";
import ConfirmDialog from "./ConfirmDialog";
import Modal from "./Modal";
import { invalidateListQueries } from "./useLists";

export interface ManageListsDialogProps {
  kind: ListKind;
  lists: ListItem[];
  onClose: () => void;
}

const ITEM_LABEL: Record<ListKind, { singular: string; plural: string }> = {
  company: { singular: "company", plural: "companies" },
  posting: { singular: "posting", plural: "postings" },
};

export default function ManageListsDialog({ kind, lists, onClose }: ManageListsDialogProps) {
  const client = useQueryClient();
  const label = ITEM_LABEL[kind];
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);
  const [deleting, setDeleting] = useState<ListItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onError = (cause: unknown) => setError(cause instanceof Error ? cause.message : "Request failed.");

  const createMutation = useMutation({
    mutationFn: (name: string) => createList(kind, name),
    onSuccess: () => {
      setNewName("");
      setError(null);
      void invalidateListQueries(client);
    },
    onError,
  });

  const renameMutation = useMutation({
    mutationFn: (args: { id: number; name: string }) => renameList(kind, args.id, args.name),
    onSuccess: () => {
      setEditing(null);
      setError(null);
      void invalidateListQueries(client);
    },
    onError,
  });

  const deleteMutation = useMutation({
    mutationFn: (list: ListItem) => deleteList(kind, list.id),
    onSuccess: () => {
      setDeleting(null);
      setError(null);
      void invalidateListQueries(client);
    },
    onError: (cause) => {
      setDeleting(null);
      onError(cause);
    },
  });

  const busy = createMutation.isPending || renameMutation.isPending || deleteMutation.isPending;

  const submitNew = (event: FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (name === "") return;
    createMutation.mutate(name);
  };

  const submitRename = (event: FormEvent) => {
    event.preventDefault();
    if (editing === null) return;
    const name = editing.name.trim();
    if (name === "") return;
    renameMutation.mutate({ id: editing.id, name });
  };

  return (
    <Modal title={`Manage ${label.singular} lists`} onClose={onClose}>
      <div className="manage-lists">
        {error !== null && (
          <p className="form-message error" role="alert">
            {error}
          </p>
        )}

        <form className="manage-lists-add" onSubmit={submitNew}>
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="New list name…"
            aria-label="New list name"
            disabled={busy}
          />
          <button type="submit" className="button" disabled={busy || newName.trim() === ""}>
            Add list
          </button>
        </form>

        {lists.length === 0 ? (
          <p className="muted">No lists yet.</p>
        ) : (
          <ul className="manage-lists-items">
            {lists.map((list) => (
              <li key={list.id} className="manage-lists-item" data-testid="manage-list-row">
                {editing?.id === list.id ? (
                  <form className="manage-lists-rename" onSubmit={submitRename}>
                    <input
                      value={editing.name}
                      onChange={(event) => setEditing({ id: list.id, name: event.target.value })}
                      aria-label={`Rename ${list.name}`}
                      autoFocus
                      disabled={busy}
                    />
                    <button type="submit" className="button" disabled={busy || editing.name.trim() === ""}>
                      Save
                    </button>
                    <button type="button" className="button-ghost" onClick={() => setEditing(null)} disabled={busy}>
                      Cancel
                    </button>
                  </form>
                ) : (
                  <>
                    <span className="manage-lists-name">{list.name}</span>
                    <span className="muted manage-lists-count">
                      {list.memberCount} {list.memberCount === 1 ? label.singular : label.plural}
                    </span>
                    <button
                      type="button"
                      className="button-ghost"
                      onClick={() => setEditing({ id: list.id, name: list.name })}
                      disabled={busy}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="button-ghost"
                      onClick={() => setDeleting(list)}
                      disabled={busy}
                      aria-label={`Delete list ${list.name}`}
                    >
                      Delete
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {deleting !== null && (
        <ConfirmDialog
          title="Delete list"
          message={
            <>
              Delete the list <strong>{deleting.name}</strong>? The {label.plural} in it are not deleted, they
              just leave the list.
            </>
          }
          confirmLabel="Delete list"
          danger
          busy={deleteMutation.isPending}
          onConfirm={() => deleteMutation.mutate(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </Modal>
  );
}
