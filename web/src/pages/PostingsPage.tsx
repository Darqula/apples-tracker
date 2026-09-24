// Postings tab: searchable, filterable posting table with client-side
// grouping (none / company / state), collapsible group sections and a
// details side panel with full CRUD. `q`, `state`, `companyId`, `groupBy`
// and `selected` live in the hash params so views stay linkable; which
// groups are collapsed is local React state only. The create/edit modal
// and the delete confirmation are local React state too (transient dialogs
// must not pollute linkable URLs).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ApiError } from "../api";
import type { Posting, State } from "../api";
import { createCompany, createPosting, deletePosting, getCompany, listCompanies, listPostings, STAGE_ORDER, STATES, updatePosting } from "../api";
import { buildHash, type NavigateFn, type RouteParams } from "../hash";
import { groupPostings, type GroupBy } from "../grouping";
import {
  emptyPostingForm,
  findCompanyByName,
  postingFormToCreateInput,
  postingFormToPatch,
  postingToForm,
  type PostingFormValues,
} from "../forms";
import DataTable from "../components/DataTable";
import SearchBox from "../components/SearchBox";
import UrlList from "../components/UrlList";
import Modal from "../components/Modal";
import ConfirmDialog from "../components/ConfirmDialog";
import PostingForm from "../components/PostingForm";
import { useHotkey } from "../useHotkey";

export interface PostingsPageProps {
  params: RouteParams;
  navigate: NavigateFn;
}

const DEFAULT_GROUP_BY: GroupBy = "state";

const GROUP_BY_OPTIONS: ReadonlyArray<{ value: GroupBy; label: string }> = [
  { value: "none", label: "None" },
  { value: "company", label: "Company" },
  { value: "state", label: "State" },
];

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function capFirst(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toUpperCase() + text.slice(1);
}

function parseIdParam(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseGroupBy(value: string | undefined): GroupBy {
  return value === "none" || value === "company" || value === "state" ? value : DEFAULT_GROUP_BY;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

// Which modal (if any) is open. Local React state, deliberately not in the
// hash: transient dialogs must not pollute linkable URLs.
type ModalState = { mode: "create" } | { mode: "edit"; posting: Posting } | null;

type DeleteTarget = { posting: Posting } | null;

async function invalidatePostingQueries(
  client: ReturnType<typeof useQueryClient>,
): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: ["postings"] }),
    client.invalidateQueries({ queryKey: ["companies"] }),
    client.invalidateQueries({ queryKey: ["company"] }),
  ]);
}

export default function PostingsPage({ params, navigate }: PostingsPageProps) {
  const client = useQueryClient();
  const q = params.q ?? "";
  const groupBy = parseGroupBy(params.groupBy);
  // Unknown state values fall back to "All" so the client never asks the
  // API for a state it would reject.
  const rawState = params.state ?? "";
  const stateFilter = (STATES as readonly string[]).includes(rawState) ? (rawState as State) : "";
  const companyId = parseIdParam(params.companyId);
  const selectedId = parseIdParam(params.selected);

  // Collapsed groups: kept out of the URL on purpose — they persist while
  // filtering/searching but reset on reload (per component remount).
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [modal, setModal] = useState<ModalState>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverFieldErrors, setServerFieldErrors] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ["postings", { q, state: stateFilter, companyId, sort: "stage", limit: 2000 }],
    queryFn: () =>
      listPostings({
        q: q === "" ? undefined : q,
        state: stateFilter === "" ? undefined : stateFilter,
        companyId: companyId ?? undefined,
        sort: "stage",
        limit: 2000,
      }),
  });

  // Name for the `companyId` filter chip; falls back to the raw id while it
  // loads (and on error).
  const chipQuery = useQuery({
    queryKey: ["company", companyId],
    queryFn: () => getCompany(companyId as number),
    enabled: companyId !== null,
  });

  // All companies, for the form's datalist and trim-/case-insensitive name
  // matching. The key shares the ["companies"] prefix, so it is invalidated
  // together with the rest of the company queries.
  const companiesAllQuery = useQuery({
    queryKey: ["companies", "all"],
    queryFn: () => listCompanies({ limit: 1000 }),
  });

  const clearServerFeedback = () => {
    setServerError(null);
    setServerFieldErrors({});
  };

  const setSearch = (value: string) => {
    // Keep the panel open while refining the search; replace so that typing
    // does not spam browser history.
    navigate("postings", { ...params, q: value }, { replace: true });
  };

  const setStateFilter = (value: string) => {
    navigate("postings", { ...params, state: value }, { replace: true });
  };

  const setGroupBy = (value: GroupBy) => {
    // The default mode is omitted from the URL to keep hashes short.
    if (value === DEFAULT_GROUP_BY) {
      const { groupBy: _removed, ...rest } = params;
      navigate("postings", rest, { replace: true });
    } else {
      navigate("postings", { ...params, groupBy: value }, { replace: true });
    }
  };

  const clearCompanyFilter = () => {
    const { companyId: _removed, ...rest } = params;
    navigate("postings", rest, { replace: true });
  };

  const closePanel = () => {
    const { selected: _removed, ...rest } = params;
    navigate("postings", rest, { replace: true });
  };

  const onRowClick = (posting: Posting) => {
    navigate("postings", { ...params, selected: String(posting.id) });
  };

  const toggleGroup = (key: string) => {
    setCollapsed((previous) => ({ ...previous, [key]: !previous[key] }));
  };

  const openCreate = () => {
    clearServerFeedback();
    setModal({ mode: "create" });
  };

  // Global `n` opens the create modal unless the user is typing somewhere.
  useHotkey("n", openCreate);

  const createMutation = useMutation({
    mutationFn: (values: PostingFormValues) =>
      createPosting(postingFormToCreateInput(values, companiesAll)),
    onSuccess: (posting) => {
      setModal(null);
      clearServerFeedback();
      void invalidatePostingQueries(client);
      // Select the newly created posting (pushes a history entry, since the
      // modal just closed).
      navigate("postings", { ...params, selected: String(posting.id) });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 404 && error.code === "NOT_FOUND") {
        // Unknown companyId → mark the Company field instead of a banner.
        setServerError(null);
        setServerFieldErrors({ companyName: error.message });
      } else {
        setServerError(error instanceof Error ? error.message : "Failed to create the posting.");
      }
    },
  });

  const updateMutation = useMutation({
    // Resolve the company first: an existing (trim- & case-insensitive)
    // match wins; anything else is created, then referenced by id.
    mutationFn: async (args: { id: number; values: PostingFormValues; original: Posting }) => {
      const existing = findCompanyByName(companiesAll, args.values.companyName);
      const companyId = existing
        ? existing.id
        : (
            await createCompany({
              name: args.values.companyName.trim(),
              website: null,
              location: null,
              description: "",
              aiContext: "",
              urls: [],
            })
          ).id;
      const patch = postingFormToPatch(args.original, args.values, companyId);
      // Nothing changed → skip the request entirely.
      if (Object.keys(patch).length === 0) return args.original;
      return updatePosting(args.id, patch);
    },
    onSuccess: () => {
      setModal(null);
      clearServerFeedback();
      void invalidatePostingQueries(client);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 404 && error.code === "NOT_FOUND") {
        setServerError(null);
        setServerFieldErrors({ companyName: error.message });
      } else {
        setServerError(error instanceof Error ? error.message : "Failed to save the posting.");
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (target: NonNullable<DeleteTarget>) => deletePosting(target.posting.id),
    onSuccess: () => {
      setDeleteTarget(null);
      setDeleteError(null);
      // Drop the deleted posting's selection from the hash and refresh.
      const { selected: _removed, ...rest } = params;
      navigate("postings", rest, { replace: true });
      void invalidatePostingQueries(client);
    },
    onError: (error) => {
      // Shown inside the open dialog, so the user can retry or cancel.
      setDeleteError(error instanceof Error ? error.message : "Failed to delete the posting.");
    },
  });

  const closeEditModal = () => {
    setModal(null);
    clearServerFeedback();
  };

  const handleFormSubmit = (values: PostingFormValues) => {
    if (modal === null) return;
    if (modal.mode === "create") {
      createMutation.mutate(values);
    } else {
      updateMutation.mutate({ id: modal.posting.id, values, original: modal.posting });
    }
  };

  const postings = listQuery.data?.items ?? [];
  const groups = useMemo(() => groupPostings(postings, groupBy), [postings, groupBy]);
  const companiesAll = companiesAllQuery.data?.items ?? [];
  const formBusy = createMutation.isPending || updateMutation.isPending;
  const hasFilters = q !== "" || stateFilter !== "" || companyId !== null;
  const emptyMessage = hasFilters
    ? "No postings match the current filters."
    : "No postings yet.";
  const selected =
    selectedId === null ? undefined : postings.find((posting) => posting.id === selectedId);

  // Create modal prefill: with an active companyId filter, suggest that
  // company (and fall back to the raw id name while the chip loads).
  const createInitial = useMemo(() => {
    const companyName =
      companyId !== null
        ? (chipQuery.data?.name ?? `Company #${companyId}`)
        : "";
    return emptyPostingForm(companyId !== null ? { companyName } : {});
  }, [companyId, chipQuery.data?.name]);

  const columns = useMemo<ColumnDef<Posting, any>[]>(
    () => [
      {
        id: "company",
        accessorFn: (row) => row.company.name,
        header: "Company",
        cell: ({ row }) => (
          <button
            type="button"
            className="link-button cell-name"
            title="Open company details"
            onClick={(event) => {
              event.stopPropagation();
              navigate("companies", { selected: String(row.original.companyId) });
            }}
          >
            {row.original.company.name}
          </button>
        ),
      },
      {
        accessorKey: "title",
        header: "Title",
        cell: (info) => <span className="cell-name">{info.getValue<string>()}</span>,
      },
      {
        accessorKey: "appliedDate",
        header: "Applied",
        cell: ({ row }) =>
          row.original.appliedDate === null ? (
            <span className="muted">—</span>
          ) : (
            row.original.appliedDate
          ),
      },
      {
        accessorKey: "state",
        header: "State",
        cell: ({ row }) => (
          <span className={`badge badge-${row.original.state}`}>{row.original.state}</span>
        ),
      },
      {
        accessorKey: "description",
        header: "Description",
        cell: ({ row }) => (
          <span className="cell-description" title={row.original.description}>
            {truncate(row.original.description, 80)}
          </span>
        ),
      },
      {
        id: "urls",
        header: "URLs",
        cell: ({ row }) => <UrlList urls={row.original.urls} />,
      },
    ],
    [navigate],
  );

  return (
    <div className={`postings-page${selectedId !== null ? " with-panel" : ""}`}>
      <section className="postings-table-area">
        <div className="page-toolbar">
          <SearchBox
            value={q}
            onChange={setSearch}
            placeholder="Search title or company…"
          />

          <label className="toolbar-field">
            <span className="toolbar-field-label">State</span>
            <select
              value={stateFilter}
              onChange={(event) => setStateFilter(event.target.value)}
            >
              <option value="">All</option>
              {STAGE_ORDER.map((state) => (
                <option key={state} value={state}>
                  {capFirst(state)}
                </option>
              ))}
            </select>
          </label>

          <div className="toolbar-field" role="group" aria-label="Group postings by">
            <span className="toolbar-field-label">Group by</span>
            <div className="segmented">
              {GROUP_BY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`segmented-button${groupBy === option.value ? " active" : ""}`}
                  aria-pressed={groupBy === option.value}
                  onClick={() => setGroupBy(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            className="button"
            onClick={openCreate}
          >
            New posting
          </button>

          {companyId !== null && (
            <span className="filter-chip">
              <span className="filter-chip-label">
                {chipQuery.data ? chipQuery.data.name : `Company #${companyId}`}
              </span>
              <button
                type="button"
                className="filter-chip-remove"
                aria-label="Remove company filter"
                onClick={clearCompanyFilter}
              >
                ×
              </button>
            </span>
          )}

          {listQuery.data !== undefined && (
            <span className="page-count">
              {listQuery.data.total} {listQuery.data.total === 1 ? "posting" : "postings"}
            </span>
          )}
        </div>

        {listQuery.isError ? (
          <p className="form-message error">
            {listQuery.error instanceof Error
              ? listQuery.error.message
              : "Failed to load postings."}
          </p>
        ) : null}

        {!listQuery.isError && groups.length === 0 ? (
          <div className="table-wrap">
            <DataTable
              data={[]}
              columns={columns}
              enableSorting={false}
              loading={listQuery.isPending}
              emptyMessage={emptyMessage}
            />
          </div>
        ) : null}

        {!listQuery.isError &&
          groups.map((group) => {
            const isCollapsed = collapsed[group.key] === true;
            return (
              <section className="posting-group" key={group.key}>
                {groupBy !== "none" && (
                  <button
                    type="button"
                    className="group-header"
                    aria-expanded={!isCollapsed}
                    onClick={() => toggleGroup(group.key)}
                  >
                    <span className="group-indicator" aria-hidden="true">
                      {isCollapsed ? "▸" : "▾"}
                    </span>
                    <span className="group-label">{group.label}</span>
                    <span className="group-count">{group.postings.length}</span>
                  </button>
                )}
                {!isCollapsed && (
                  <div className="table-wrap">
                    <DataTable
                      data={group.postings}
                      columns={columns}
                      onRowClick={(posting) => onRowClick(posting)}
                      enableSorting={false}
                      getRowId={(row) => String(row.id)}
                      emptyMessage={emptyMessage}
                    />
                  </div>
                )}
              </section>
            );
          })}
      </section>

      {selectedId !== null && (
        <aside className="side-panel">
          <div className="side-panel-header">
            <h2 className="side-panel-title">Posting details</h2>
            <button
              type="button"
              className="side-panel-close"
              aria-label="Close details"
              onClick={closePanel}
            >
              ×
            </button>
          </div>
          {listQuery.isError ? (
            <p className="form-message error">
              {listQuery.error instanceof Error
                ? listQuery.error.message
                : "Failed to load postings."}
            </p>
          ) : listQuery.isPending ? (
            <p className="muted">Loading…</p>
          ) : selected === undefined ? (
            <p className="muted">Posting not found in the current filters.</p>
          ) : (
            <SelectedPostingPanel
              posting={selected}
              openEdit={(posting) => {
                clearServerFeedback();
                setModal({ mode: "edit", posting });
              }}
              openDelete={(posting) => {
                setDeleteError(null);
                setDeleteTarget({ posting });
              }}
            />
          )}
        </aside>
      )}

      {modal !== null && (
        <Modal
          title={modal.mode === "create" ? "New posting" : "Edit posting"}
          onClose={closeEditModal}
        >
          <PostingForm
            key={modal.mode === "create" ? "create" : `edit-${modal.posting.id}`}
            initial={modal.mode === "create" ? createInitial : postingToForm(modal.posting)}
            companyNames={companiesAll.map((company) => company.name)}
            submitLabel={modal.mode === "create" ? "Create posting" : "Save changes"}
            busy={formBusy}
            serverError={serverError}
            fieldErrors={serverFieldErrors}
            onSubmit={handleFormSubmit}
            onCancel={closeEditModal}
            onDelete={
              // Hand the delete over to the confirm dialog; the form's own
              // Delete button only applies to postings that already exist.
              modal.mode === "edit"
                ? () => {
                    setModal(null);
                    clearServerFeedback();
                    setDeleteTarget({ posting: modal.posting });
                  }
                : undefined
            }
          />
        </Modal>
      )}

      {deleteTarget !== null && (
        <ConfirmDialog
          title="Delete posting"
          message={
            <>
              Delete posting? <strong>{deleteTarget.posting.title}</strong> at{" "}
              <strong>{deleteTarget.posting.company.name}</strong>. This cannot be undone.
            </>
          }
          confirmLabel={`Delete ${truncate(deleteTarget.posting.title, 40)}`}
          danger
          busy={deleteMutation.isPending}
          error={deleteError}
          onConfirm={() => {
            setDeleteError(null);
            deleteMutation.mutate(deleteTarget);
          }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

interface SelectedPostingPanelProps {
  posting: Posting;
  openEdit: (posting: Posting) => void;
  openDelete: (posting: Posting) => void;
}

function SelectedPostingPanel({ posting, openEdit, openDelete }: SelectedPostingPanelProps) {
  return (
    <div className="posting-details">
      <h3 className="posting-details-title">{posting.title}</h3>
      <div className="side-panel-actions">
        <button type="button" className="button-ghost" onClick={() => openEdit(posting)}>
          Edit
        </button>
        <button type="button" className="button button-danger" onClick={() => openDelete(posting)}>
          Delete
        </button>
      </div>
      <p className="company-details-line">
        <span className="detail-label">Company: </span>
        <a href={buildHash("companies", { selected: String(posting.companyId) })}>
          {posting.company.name}
        </a>
      </p>
      <p className="company-details-line">
        <span className="detail-label">State: </span>
        <span className={`badge badge-${posting.state}`}>{posting.state}</span>
      </p>
      <p className="company-details-line">
        <span className="detail-label">Applied: </span>
        {posting.appliedDate === null ? <span className="muted">—</span> : posting.appliedDate}
      </p>
      <p className="company-details-line">
        <span className="detail-label">Description: </span>
        {posting.description === "" ? <span className="muted">—</span> : posting.description}
      </p>
      {posting.aiContext !== "" && (
        <section className="detail-block">
          <h4 className="detail-label">AI context</h4>
          <p className="detail-pre">{posting.aiContext}</p>
        </section>
      )}
      <section className="detail-block">
        <h4 className="detail-label">URLs</h4>
        <UrlList urls={posting.urls} />
      </section>
      <section className="detail-block">
        <h4 className="detail-label">Timestamps</h4>
        <p className="company-details-line panel-date">
          Created {formatTimestamp(posting.createdAt)}
        </p>
        <p className="company-details-line panel-date">
          Updated {formatTimestamp(posting.updatedAt)}
        </p>
      </section>
    </div>
  );
}
