// Companies tab: searchable company table with an optional details side
// panel and full CRUD. Search text and the selected panel company live in
// the hash params (`q`, `selected`) so views stay linkable; the create/edit
// modal and the delete confirmation are local React state only on purpose
// (modals are transient, the panel choice is what stays linkable).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ApiError } from "../api";
import type { Company, CompanyDetail } from "../api";
import { createCompany, deleteCompany, getCompany, listCompanies, updateCompany } from "../api";
import {
  buildHash,
  type NavigateFn,
  type RouteParams,
} from "../hash";
import {
  companyFormToInput,
  companyFormToPatch,
  companyToForm,
  emptyCompanyForm,
  type CompanyFormValues,
} from "../forms";
import DataTable from "../components/DataTable";
import SearchBox from "../components/SearchBox";
import UrlList, { urlHostname } from "../components/UrlList";
import Modal from "../components/Modal";
import ConfirmDialog from "../components/ConfirmDialog";
import CompanyForm from "../components/CompanyForm";
import { useHotkey } from "../useHotkey";

export interface CompaniesPageProps {
  params: RouteParams;
  navigate: NavigateFn;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// Which modal (if any) is open. Local React state, deliberately not in the
// hash: transient dialogs must not pollute linkable URLs.
type ModalState = { mode: "create" } | { mode: "edit"; company: CompanyDetail } | null;

type DeleteTarget = { company: CompanyDetail; cascade: boolean } | null;

async function invalidateCompanyQueries(client: ReturnType<typeof useQueryClient>): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: ["companies"] }),
    client.invalidateQueries({ queryKey: ["company"] }),
    client.invalidateQueries({ queryKey: ["postings"] }),
  ]);
}

export default function CompaniesPage({ params, navigate }: CompaniesPageProps) {
  const client = useQueryClient();
  const q = params.q ?? "";
  const selectedParam = params.selected ?? "";
  const parsedSelection = Number(selectedParam);
  const selectedId =
    selectedParam !== "" && Number.isInteger(parsedSelection) && parsedSelection > 0
      ? parsedSelection
      : null;

  const [modal, setModal] = useState<ModalState>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverFieldErrors, setServerFieldErrors] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ["companies", { q }],
    queryFn: () => listCompanies({ q: q === "" ? undefined : q }),
  });

  const detailQuery = useQuery({
    queryKey: ["company", selectedId],
    queryFn: () => getCompany(selectedId as number),
    enabled: selectedId !== null,
  });

  const clearServerFeedback = () => {
    setServerError(null);
    setServerFieldErrors({});
  };

  const setSearch = (value: string) => {
    // Keep the panel open while refining the search; replace so that typing
    // does not spam browser history.
    navigate("companies", value === "" ? { selected: selectedParam } : { q: value, selected: selectedParam }, {
      replace: true,
    });
  };

  const closePanel = () => {
    navigate("companies", q === "" ? {} : { q }, { replace: true });
  };

  const onRowClick = (company: Company) => {
    navigate("companies", { q: q, selected: String(company.id) });
  };

  // Global `n` opens the create modal unless the user is typing somewhere.
  useHotkey("n", () => {
    clearServerFeedback();
    setModal({ mode: "create" });
  });

  const createMutation = useMutation({
    mutationFn: (values: CompanyFormValues) => createCompany(companyFormToInput(values)),
    onSuccess: (company) => {
      setModal(null);
      clearServerFeedback();
      void invalidateCompanyQueries(client);
      // Select the newly created company (pushes a history entry, since the
      // modal just closed).
      navigate("companies", { q: q, selected: String(company.id) });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === "CONFLICT") {
        // Duplicate name → mark the Name field instead of a generic banner.
        setServerError(null);
        setServerFieldErrors({ name: error.message });
      } else {
        setServerError(error instanceof Error ? error.message : "Failed to create the company.");
      }
    },
  });

  const updateMutation = useMutation({
    mutationFn: (args: { id: number; values: CompanyFormValues; original: Company }) =>
      updateCompany(args.id, companyFormToPatch(args.original, args.values)),
    onSuccess: () => {
      setModal(null);
      clearServerFeedback();
      void invalidateCompanyQueries(client);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === "CONFLICT") {
        setServerError(null);
        setServerFieldErrors({ name: error.message });
      } else {
        setServerError(error instanceof Error ? error.message : "Failed to save the company.");
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (target: NonNullable<DeleteTarget>) =>
      deleteCompany(target.company.id, target.cascade),
    onSuccess: () => {
      setDeleteTarget(null);
      setDeleteError(null);
      // Drop the deleted company's selection from the hash and refresh.
      navigate("companies", q === "" ? {} : { q }, { replace: true });
      void invalidateCompanyQueries(client);
    },
    onError: (error) => {
      // Shown inside the open dialog, so the user can retry or cancel.
      setDeleteError(error instanceof Error ? error.message : "Failed to delete the company.");
    },
  });

  const closeEditModal = () => {
    setModal(null);
    clearServerFeedback();
  };

  const handleFormSubmit = (values: CompanyFormValues) => {
    if (modal === null) return;
    if (modal.mode === "create") {
      createMutation.mutate(values);
    } else {
      updateMutation.mutate({
        id: modal.company.id,
        values,
        original: modal.company,
      });
    }
  };

  const columns = useMemo<ColumnDef<Company, any>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        cell: (info) => <span className="cell-name">{info.getValue<string>()}</span>,
      },
      {
        accessorFn: (row) => row.website ?? "",
        id: "website",
        header: "Website",
        cell: ({ row }) => {
          const website = row.original.website;
          if (website === null) return <span className="muted">—</span>;
          return (
            <a
              href={website}
              target="_blank"
              rel="noreferrer"
              title={website}
              onClick={(event) => event.stopPropagation()}
            >
              {urlHostname(website)}
            </a>
          );
        },
      },
      {
        accessorFn: (row) => row.location ?? "",
        id: "location",
        header: "Location",
        cell: ({ row }) =>
          row.original.location === null ? <span className="muted">—</span> : row.original.location,
      },
      {
        accessorKey: "description",
        header: "Description",
        cell: ({ row }) => {
          const description = row.original.description;
          return <span className="cell-description" title={description}>{truncate(description, 80)}</span>;
        },
      },
      {
        accessorKey: "postingCount",
        header: "Postings",
        cell: ({ row }) => (
          <button
            type="button"
            className="link-button"
            title="Show this company's postings"
            onClick={(event) => {
              event.stopPropagation();
              navigate("postings", { companyId: String(row.original.id) });
            }}
          >
            {row.original.postingCount}
          </button>
        ),
      },
      {
        id: "urls",
        header: "URLs",
        enableSorting: false,
        cell: ({ row }) => <UrlList urls={row.original.urls} />,
      },
    ],
    [navigate],
  );

  const companies = listQuery.data?.items ?? [];
  const formBusy = createMutation.isPending || updateMutation.isPending;

  return (
    <div className={`companies-page${selectedId !== null ? " with-panel" : ""}`}>
      <section className="companies-table-area">
        <div className="page-toolbar">
          <SearchBox
            value={q}
            onChange={setSearch}
            placeholder="Search companies…"
          />
          <button
            type="button"
            className="button"
            onClick={() => {
              clearServerFeedback();
              setModal({ mode: "create" });
            }}
          >
            New company
          </button>
          {listQuery.data !== undefined && (
            <span className="page-count">
              {listQuery.data.total} {listQuery.data.total === 1 ? "company" : "companies"}
            </span>
          )}
        </div>

        {listQuery.isError ? (
          <p className="form-message error">
            {listQuery.error instanceof Error ? listQuery.error.message : "Failed to load companies."}
          </p>
        ) : null}

        <div className="table-wrap">
          <DataTable
            data={companies}
            columns={columns}
            onRowClick={onRowClick}
            loading={listQuery.isPending}
            emptyMessage={
              q === "" ? "No companies yet." : "No companies match the search."
            }
            getRowId={(row) => String(row.id)}
          />
        </div>
      </section>

      {selectedId !== null && (
        <aside className="side-panel">
          <div className="side-panel-header">
            <h2 className="side-panel-title">Company details</h2>
            <button
              type="button"
              className="side-panel-close"
              aria-label="Close details"
              onClick={closePanel}
            >
              ×
            </button>
          </div>
          {detailQuery.isPending ? (
            <p className="muted">Loading…</p>
          ) : detailQuery.isError ? (
            <p className="form-message error">
              {detailQuery.error instanceof Error
                ? detailQuery.error.message
                : "Failed to load the company."}
            </p>
          ) : detailQuery.data !== undefined ? (
            <SelectedCompanyPanel
              company={detailQuery.data}
              openEdit={(company) => {
                clearServerFeedback();
                setModal({ mode: "edit", company });
              }}
              openDelete={(company) => {
                setDeleteError(null);
                setDeleteTarget({ company, cascade: company.postingCount > 0 });
              }}
            />
          ) : null}
        </aside>
      )}

      {modal !== null && (
        <Modal
          title={modal.mode === "create" ? "New company" : "Edit company"}
          onClose={closeEditModal}
        >
          <CompanyForm
            key={modal.mode === "create" ? "create" : `edit-${modal.company.id}`}
            initial={modal.mode === "create" ? emptyCompanyForm() : companyToForm(modal.company)}
            submitLabel={modal.mode === "create" ? "Create company" : "Save changes"}
            busy={formBusy}
            serverError={serverError}
            fieldErrors={serverFieldErrors}
            onSubmit={handleFormSubmit}
            onCancel={closeEditModal}
            onDelete={
              // Hand the delete over to the confirm dialog; the form's own
              // Delete button only makes sense for companies that already
              // exist (and currently without postings, since the cascade
              // confirm lists postings the form cannot show well).
              modal.mode === "edit" && modal.company.postingCount === 0
                ? () => {
                    setModal(null);
                    clearServerFeedback();
                    setDeleteTarget({ company: modal.company, cascade: false });
                  }
                : undefined
            }
          />
        </Modal>
      )}

      {deleteTarget !== null && (
        <ConfirmDialog
          title="Delete company"
          message={
            deleteTarget.cascade ? (
              <>
                <strong>{deleteTarget.company.name}</strong> has{" "}
                {deleteTarget.company.postingCount}{" "}
                {deleteTarget.company.postingCount === 1 ? "posting" : "postings"}. Deleting the
                company will also permanently delete all of them.
              </>
            ) : (
              <>
                Delete <strong>{deleteTarget.company.name}</strong>? This cannot be undone.
              </>
            )
          }
          confirmLabel={
            deleteTarget.cascade
              ? `Delete company and ${deleteTarget.company.postingCount} ${
                  deleteTarget.company.postingCount === 1 ? "posting" : "postings"
                }`
              : `Delete ${deleteTarget.company.name}`
          }
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

interface SelectedCompanyPanelProps {
  company: CompanyDetail;
  openEdit: (company: CompanyDetail) => void;
  openDelete: (company: CompanyDetail) => void;
}

function formatAppliedDate(appliedDate: string | null): string {
  return appliedDate ?? "—";
}

function SelectedCompanyPanel({ company, openEdit, openDelete }: SelectedCompanyPanelProps) {
  return (
    <div className="company-details">
      <h3 className="company-details-name">{company.name}</h3>
      <div className="side-panel-actions">
        <button type="button" className="button-ghost" onClick={() => openEdit(company)}>
          Edit
        </button>
        <button type="button" className="button button-danger" onClick={() => openDelete(company)}>
          Delete
        </button>
      </div>
      <p className="company-details-line">
        <span className="detail-label">Website: </span>
        {company.website === null ? (
          <span className="muted">—</span>
        ) : (
          <a href={company.website} target="_blank" rel="noreferrer">
            {urlHostname(company.website)}
          </a>
        )}
      </p>
      <p className="company-details-line">
        <span className="detail-label">Location: </span>
        {company.location === null ? <span className="muted">—</span> : company.location}
      </p>
      <p className="company-details-line">
        <span className="detail-label">Description: </span>
        {company.description === "" ? <span className="muted">—</span> : company.description}
      </p>
      {company.aiContext !== "" && (
        <section className="detail-block">
          <h4 className="detail-label">AI context</h4>
          <p className="detail-pre">{company.aiContext}</p>
        </section>
      )}
      <section className="detail-block">
        <h4 className="detail-label">URLs</h4>
        <UrlList urls={company.urls} />
      </section>
      <section className="detail-block">
        <h4 className="detail-label">Postings ({company.postings.length})</h4>
        {company.postings.length === 0 ? (
          <p className="muted">No postings yet.</p>
        ) : (
          <ul className="panel-postings">
            {company.postings.map((posting) => (
              <li key={posting.id}>
                <a href={buildHash("postings", { selected: String(posting.id) })}>
                  {posting.title}
                </a>
                <span className={`badge badge-${posting.state}`}>{posting.state}</span>
                <span className="panel-date">
                  applied {formatAppliedDate(posting.appliedDate)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
