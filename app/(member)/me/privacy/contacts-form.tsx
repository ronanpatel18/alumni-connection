"use client";

import { useActionState } from "react";
import { Icon } from "@/components/icon";
import { type FormState, saveContacts } from "../actions";

export interface ContactRow {
  kind: "email" | "phone" | "website" | "linkedin";
  label: string;
  value: string;
  verified: boolean;
  type: string;
  placeholder: string;
}

function ContactField({ row, error }: { row: ContactRow; error?: string }) {
  return (
    <div className="detail-row">
      <div className="od-row">
        <strong className="small">{row.label}</strong>
        {row.verified && <span className="chip success">Verified</span>}
      </div>
      <label className="sr-only" htmlFor={`${row.kind}_value`}>
        {row.label}
      </label>
      <input
        id={`${row.kind}_value`}
        name={`${row.kind}_value`}
        type={row.type}
        defaultValue={row.value}
        placeholder={row.placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${row.kind}-error` : undefined}
      />
      {error && (
        <span className="error-text" id={`${row.kind}-error`}>
          {error}
        </span>
      )}
    </div>
  );
}

export function ContactsForm({ rows }: { rows: ContactRow[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveContacts, { status: "idle" });
  const errors = state.status === "error" ? (state.fields ?? {}) : {};
  return (
    <form action={action} className="panel pad">
      <h2>Contact details</h2>
      <p className="small muted" style={{ margin: "12px 0 24px" }}>
        Everything here is visible to all verified members, meaning alumni who have completed verification. Leave a field blank to keep it off
        your profile. What you enter replaces anything found from public sources, and is the only kind of contact detail shown without
        an administrator’s review.
      </p>
      {state.status !== "idle" && (
        <div className={`notice ${state.status === "saved" ? "success" : "error"}`} role={state.status === "saved" ? "status" : "alert"} style={{ marginBottom: 24 }}>
          <Icon name={state.status === "saved" ? "check" : "info"} />
          <div>{state.message}</div>
        </div>
      )}
      <div className="stack">
        {rows.map((row) => (
          <ContactField key={row.kind} row={row} error={errors[`${row.kind}_value`]} />
        ))}
      </div>
      <div className="form-actions">
        <button type="submit" className="btn primary" disabled={pending}>
          {pending ? "Saving…" : "Save contact details"}
        </button>
      </div>
    </form>
  );
}
