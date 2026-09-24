// Confirmation dialog for destructive actions, built on the Modal component.

import type { ReactNode } from "react";
import Modal from "./Modal";

export interface ConfirmDialogProps {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  /** Shown above the buttons when the confirm action failed. */
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger = false,
  busy = false,
  error = null,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <div className="form-actions">
          <button
            type="button"
            className={danger ? "button button-danger" : "button"}
            onClick={onConfirm}
            disabled={busy}
          >
            {confirmLabel}
          </button>
          <button type="button" className="button-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      }
    >
      <p className="confirm-message">{message}</p>
    </Modal>
  );
}
