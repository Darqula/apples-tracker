// Controlled posting create/edit form — mirrors CompanyForm: validation runs
// in the parent via validatePostingForm on submit; this component shows the
// resulting errors inline, blocks submission while invalid, and passes
// server errors back as per-field hints (e.g. an unknown companyId 404).

import { useState, type FormEvent, type KeyboardEvent } from "react";
import type { PostingFormValues } from "../forms";
import { validatePostingForm } from "../forms";
import { STAGE_ORDER } from "../api";

export interface PostingFormProps {
  initial: PostingFormValues;
  /** Names for the company <datalist> (existing companies). */
  companyNames: string[];
  submitLabel: string;
  busy: boolean;
  serverError?: string | null;
  fieldErrors?: Record<string, string>;
  onSubmit: (values: PostingFormValues) => void;
  onCancel: () => void;
  /** Renders a Delete button (form-level, left-aligned) when provided. */
  onDelete?: () => void;
}

const COMPANY_HINT = "Pick an existing company or type a new name to create it";
const URLS_HINT = "One URL per line; each must start with http:// or https://.";

function capFirst(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toUpperCase() + text.slice(1);
}

export default function PostingForm({
  initial,
  companyNames,
  submitLabel,
  busy,
  serverError = null,
  fieldErrors = {},
  onSubmit,
  onCancel,
  onDelete,
}: PostingFormProps) {
  const [values, setValues] = useState<PostingFormValues>(initial);
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});

  const setValue = (field: keyof PostingFormValues) => (value: string) => {
    setValues((previous) => ({ ...previous, [field]: value }));
  };

  // Client-side errors win until the next submit attempt; server errors are
  // shown immediately (serverError is often per-field too, e.g. company).
  const errors: Record<string, string> = { ...fieldErrors, ...clientErrors };

  const handleSubmit = () => {
    const nextErrors = validatePostingForm(values);
    setClientErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    onSubmit(values);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // Implicit form submission would also fire for textareas; guard so that
    // multi-line text keeps its newlines and Enter submits only in
    // single-line inputs.
    const target = event.target as HTMLElement;
    if (event.key === "Enter" && target.tagName !== "TEXTAREA") {
      event.preventDefault();
      handleSubmit();
    }
  };

  const onSubmitForm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    handleSubmit();
  };

  const fieldError = (field: keyof PostingFormValues): string | undefined => errors[field];

  return (
    <form className="form-grid" onSubmit={onSubmitForm} onKeyDown={onKeyDown} noValidate>
      {serverError !== null && serverError !== "" ? (
        <p className="form-message error" role="alert">
          {serverError}
        </p>
      ) : null}

      <label className="form-field">
        <span className="form-field-label">Company</span>
        <input
          value={values.companyName}
          onChange={(event) => setValue("companyName")(event.target.value)}
          disabled={busy}
          autoFocus={initial.companyName === ""}
          list="posting-form-companies"
        />
        <datalist id="posting-form-companies">
          {companyNames.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <span className="form-hint">{COMPANY_HINT}</span>
        {fieldError("companyName") !== undefined && (
          <span className="form-field-error">{fieldError("companyName")}</span>
        )}
      </label>

      <label className="form-field">
        <span className="form-field-label">Title</span>
        <input
          value={values.title}
          onChange={(event) => setValue("title")(event.target.value)}
          disabled={busy}
          autoFocus={initial.companyName !== ""}
        />
        {fieldError("title") !== undefined && (
          <span className="form-field-error">{fieldError("title")}</span>
        )}
      </label>

      <label className="form-field">
        <span className="form-field-label">State</span>
        <select
          value={values.state}
          onChange={(event) => setValue("state")(event.target.value)}
          disabled={busy}
        >
          {STAGE_ORDER.map((state) => (
            <option key={state} value={state}>
              {capFirst(state)}
            </option>
          ))}
        </select>
        {fieldError("state") !== undefined && (
          <span className="form-field-error">{fieldError("state")}</span>
        )}
      </label>

      <label className="form-field">
        <span className="form-field-label">Applied date</span>
        <input
          type="date"
          value={values.appliedDate}
          onChange={(event) => setValue("appliedDate")(event.target.value)}
          disabled={busy}
        />
        {fieldError("appliedDate") !== undefined && (
          <span className="form-field-error">{fieldError("appliedDate")}</span>
        )}
      </label>

      <label className="form-field">
        <span className="form-field-label">Description</span>
        <textarea
          value={values.description}
          onChange={(event) => setValue("description")(event.target.value)}
          disabled={busy}
          rows={3}
        />
        {fieldError("description") !== undefined && (
          <span className="form-field-error">{fieldError("description")}</span>
        )}
      </label>

      <label className="form-field">
        <span className="form-field-label">AI context (notes for AI assistants, not shown in tables)</span>
        <textarea
          value={values.aiContext}
          onChange={(event) => setValue("aiContext")(event.target.value)}
          disabled={busy}
          rows={3}
        />
        {fieldError("aiContext") !== undefined && (
          <span className="form-field-error">{fieldError("aiContext")}</span>
        )}
      </label>

      <label className="form-field">
        <span className="form-field-label">URLs</span>
        <textarea
          value={values.urlsText}
          onChange={(event) => setValue("urlsText")(event.target.value)}
          disabled={busy}
          rows={3}
          placeholder="https://careers.example.com/senior-engineer"
        />
        <span className="form-hint">{URLS_HINT}</span>
        {fieldError("urlsText") !== undefined && (
          <span className="form-field-error">{fieldError("urlsText")}</span>
        )}
      </label>

      <div className="form-actions">
        {onDelete !== undefined && (
          <button
            type="button"
            className="form-actions-left button button-danger"
            onClick={onDelete}
            disabled={busy}
          >
            Delete
          </button>
        )}
        <button type="button" className="button-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="button" disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
