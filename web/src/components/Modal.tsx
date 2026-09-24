// Accessible modal on top of the native <dialog> element: showModal() traps
// focus and closes on Escape natively; we only bridge the events to the
// parent's onClose and add backdrop-click-to-close.

import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";

export interface ModalProps {
  title: string;
  /** Called to trigger the actual removal (unmounting) of the dialog. */
  onClose: () => void;
  children: ReactNode;
  /** Optional bottom bar, right-aligned via .form-actions styles. */
  footer?: ReactNode;
}

export default function Modal({ title, onClose, children, footer }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    dialog.showModal();
    return () => dialog.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clicks land on the <dialog> element itself only for the backdrop (the
  // backdrop is not a separate event target); clicks inside the padding area
  // must not close, so check the click position against the dialog box.
  const onDialogClick = (event: MouseEvent<HTMLDialogElement>) => {
    const dialog = dialogRef.current;
    if (dialog === null || event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    const insideBox =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    if (!insideBox) onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      aria-labelledby="modal-title"
      onCancel={(event) => {
        // Natively fired on Escape; keep the dialog open and let the parent
        // unmount it via onClose.
        event.preventDefault();
        onClose();
      }}
      onClick={onDialogClick}
    >
      <div className="modal-header">
        <h2 className="modal-title" id="modal-title">
          {title}
        </h2>
        <button
          type="button"
          className="side-panel-close"
          aria-label="Close"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="modal-body">{children}</div>
      {footer !== undefined && <div className="modal-footer">{footer}</div>}
    </dialog>
  );
}
