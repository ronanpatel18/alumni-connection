"use client";

import { type ReactNode, useRef } from "react";
import { Icon } from "./icon";

/** Native <dialog> with a visible close control; Escape closes it and focus returns to the trigger. */
export function DialogButton({ label, title, className = "btn quiet", children }: { label: string; title: string; className?: string; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => {
    dialog.current?.close();
    trigger.current?.focus();
  };
  return (
    <>
      <button ref={trigger} type="button" className={className} onClick={() => dialog.current?.showModal()}>
        {label}
      </button>
      <dialog ref={dialog} aria-label={title} onClose={() => trigger.current?.focus()}>
        <button type="button" className="icon-button close" onClick={close} aria-label="Close dialog">
          <Icon name="close" />
        </button>
        <h2>{title}</h2>
        {children}
        <div className="form-actions">
          <button type="button" className="btn primary" onClick={close}>
            Close
          </button>
        </div>
      </dialog>
    </>
  );
}
