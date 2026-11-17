"use client";

import { type ReactNode, useId, useRef } from "react";
import { Icon } from "./icon";

/**
 * Native modal <dialog> with a visible close control. The browser handles
 * Escape (and the back gesture), keeps focus inside, and returns focus to the
 * trigger on close, so none of that is scripted here.
 */
export function DialogButton({ label, title, className = "btn quiet", children }: { label: string; title: string; className?: string; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const close = () => dialog.current?.close();
  return (
    <>
      <button type="button" className={className} onClick={() => dialog.current?.showModal()}>
        {label}
      </button>
      <dialog ref={dialog} aria-labelledby={titleId}>
        <button type="button" className="icon-button close" onClick={close} aria-label="Close dialog">
          <Icon name="close" />
        </button>
        <h2 id={titleId}>{title}</h2>
        {children}
        <div className="form-actions">
          <button type="button" className="btn" onClick={close}>
            Close
          </button>
        </div>
      </dialog>
    </>
  );
}
