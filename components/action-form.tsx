"use client";

import { type ReactNode, useActionState, useTransition } from "react";
import { Icon } from "./icon";

export type FormState = { status: "idle" } | { status: "error"; message: string };

/**
 * A form around a server action that returns an error message or redirects.
 * Unlike a plain `action` form, what the person typed stays put when the
 * action reports a problem. Times typed into datetime-local fields are sent
 * with a matching `<name>_iso` value in the browser's own time zone.
 */
export function ActionForm({
  action,
  submitLabel,
  pendingLabel,
  secondary,
  className = "panel pad",
  children,
}: {
  action: (prev: FormState, data: FormData) => Promise<FormState>;
  submitLabel: string;
  pendingLabel: string;
  secondary?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const [state, run] = useActionState<FormState, FormData>(action, { status: "idle" });
  const [pending, startTransition] = useTransition();
  return (
    <form
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        for (const input of form.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]')) {
          const at = input.value ? new Date(input.value) : null;
          if (at && !Number.isNaN(at.getTime())) data.set(`${input.name}_iso`, at.toISOString());
        }
        startTransition(() => run(data));
      }}
    >
      {state.status === "error" && (
        <div className="notice error" role="alert" style={{ marginBottom: 24 }}>
          <Icon name="info" />
          <div>{state.message}</div>
        </div>
      )}
      {children}
      <div className="form-actions">
        <button type="submit" className="btn primary" disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </button>
        {secondary}
      </div>
    </form>
  );
}
