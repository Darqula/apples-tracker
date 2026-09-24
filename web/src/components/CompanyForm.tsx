// Controlled company create/edit form. Validation runs in the parent via
// validateCompanyForm on submit; this component shows the resulting errors
// inline, blocks submission while invalid, and passes server errors back as
// per-field hints (e.g. a 409 name conflict).

import { useState, type FormEvent, type KeyboardEvent } from "react";
import type { CompanyFormValues } from "../forms";
import { validateCompanyForm } from "../forms";

export interface CompanyFormProps {
  initial: CompanyFormValues;
  submitLabel: string;
  busy: boolean;
  serverError?: string | null;
  fieldErrors?: Record<string, string>;
  onSubmit: (values: CompanyFormValues) => void;
  onCancel: () => void;
  /** Renders a Delete button (form-level, left-aligned) when provided. */
  onDelete?: () => void;
}

const URLS_HINT = "One URL per line; each must start with http:// or https://.";

export default function CompanyForm({
  initial,
  submitLabel,
  busy,
  serverError = null,
  fieldErrors = {},
  onSubmit,
  onCancel,
  onDelete,
}: CompanyFormProps) {
  const [values, setValues] = useState<CompanyFormValues>(initial);
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});

  const setValue = (field: keyof CompanyFormValues) => (value: string) => {
    setValues((previous) => ({ ...previous, [field]: value }));
  };

  // Client-side errors win until the next submit attempt; server errors are
  // shown immediately (serverError is often per-field too, e.g. name).
  const errors: Record<string, string> = { ...fieldErrors, ...clientErrors };

  const handleSubmit = () => {
    const nextErrors = validateCompanyForm(values);
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

  const fieldError = (field: keyof CompanyFormValues): string | undefined => errors[field];

  return (
    <form className="form-grid" onSubmit={onSubmitForm} onKeyDown={onKeyDown} noValidate>
      {serverError !== null && serverError !== "" ? (
        <p className="form-message error" role="alert">
          {serverError}
        </p>
      ) : null}

      <label className="form-field">
        <span className="form-field-label">Name</span>
        <input
          value={values.name}
          onChange={(event) => setValue("name")(event.target.value)}
          disabled={busy}
          autoFocus
        />
        {fieldError("name") !== undefined && (
          <span className="form-field-error">{fieldError("name")}</span>
        )}
      </label>

      <label className="form-field">
        <span className="form-field-label">Website</span>
        <input
          type="url"
          value={values.website}
          onChange={(event) => setValue("website")(event.target.value)}
          disabled={busy}
          placeholder="https://example.com"
        />
        {fieldError("website") !== undefined && (
          <span className="form-field-error">{fieldError("website")}</span>
        )}
      </label>

      <label className="form-field">
        <span className="form-field-label">Location</span>
        <input
          value={values.location}
          onChange={(event) => setValue("location")(event.target.value)}
          disabled={busy}
        />
        {fieldError("location") !== undefined && (
          <span className="form-field-error">{fieldError("location")}</span>
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
