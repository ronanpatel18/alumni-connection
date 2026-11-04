"use client";

import { useActionState, useState } from "react";
import { Icon } from "@/components/icon";
import { VISIBILITY_HELP, VISIBILITY_LABELS } from "@/lib/provenance";
import { type FormState, saveContacts } from "../actions";

export interface ContactRow {
  kind: "email" | "phone" | "website" | "linkedin";
  label: string;
  value: string;
  visibility: string;
  verified: boolean;
  type: string;
  placeholder: string;
}

function ContactField({ row, error }: { row: ContactRow; error?: string }) {
  const [visibility, setVisibility] = useState(row.visibility);
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
        aria-describedby={`${row.kind}-help${error ? ` ${row.kind}-error` : ""}`}
      />
      {error && (
        <span className="error-text" id={`${row.kind}-error`}>
          {error}
        </span>
      )}
      <label className="sr-only" htmlFor={`${row.kind}_visibility`}>
        {row.label} visibility
      </label>
      <select id={`${row.kind}_visibility`} name={`${row.kind}_visibility`} value={visibility} onChange={(e) => setVisibility(e.target.value)}>
        {Object.entries(VISIBILITY_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <span className="meta" id={`${row.kind}-help`}>
        {VISIBILITY_HELP[visibility]}
      </span>
    </div>
  );
}

export function ContactsForm({ rows }: { rows: ContactRow[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveContacts, { status: "idle" });
  const errors = state.status === "error" ? (state.fields ?? {}) : {};
  return (
    <form action={action} className="panel pad">
      <h2>Contact visibility</h2>
      <p className="small muted" style={{ margin: "12px 0 24px" }}>
        “Verified members” means alumni who have completed verification. “Connections” means people whose connection you’ve accepted.
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
          {pending ? "Saving…" : "Save privacy settings"}
        </button>
      </div>
    </form>
  );
}
