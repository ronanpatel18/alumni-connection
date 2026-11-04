"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Icon } from "@/components/icon";
import { OPEN_TO_LABELS } from "@/lib/labels";
import { type FormState, saveProfile } from "./actions";

export interface EditProfileDefaults {
  full_name: string;
  current_title: string;
  employer: string;
  place_id: string;
  current_city: string;
  industry_id: string;
  class_year: string;
  school: string;
  degree_major: string;
  open_to: string[];
  bio: string;
}

interface Option {
  value: string;
  label: string;
}

function Field({ id, label, error, help, children }: { id: string; label: string; error?: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {help && <small id={`${id}-help`}>{help}</small>}
      {error && (
        <span className="error-text" id={`${id}-error`}>
          {error}
        </span>
      )}
    </div>
  );
}

export function EditProfileForm({
  defaults,
  places,
  industries,
  confirmed,
}: {
  defaults: EditProfileDefaults;
  places: Option[];
  industries: { sector: string; options: Option[] }[];
  confirmed: boolean;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveProfile, { status: "idle" });
  const errors = state.status === "error" ? (state.fields ?? {}) : {};
  const invalid = (key: string) => (errors[key] ? { "aria-invalid": true, "aria-describedby": `${key}-error` } : {});

  return (
    <form action={action} className="narrow panel pad">
      {state.status === "saved" ? (
        <div className="notice success" role="status">
          <Icon name="check" />
          <div>{state.message}</div>
        </div>
      ) : state.status === "error" ? (
        <div className="notice error" role="alert">
          <Icon name="info" />
          <div>{state.message}</div>
        </div>
      ) : (
        <div className="notice">
          <Icon name="info" />
          <div>
            {confirmed ? "Your profile is confirmed." : "Your profile is waiting for confirmation."} Saving an edit doesn’t change the
            privacy of your contact details.
          </div>
        </div>
      )}

      <div className="form-grid" style={{ marginTop: 24 }}>
        <Field id="full_name" label="Full name" error={errors.full_name}>
          <input id="full_name" name="full_name" defaultValue={defaults.full_name} required autoComplete="name" {...invalid("full_name")} />
        </Field>
        <Field id="current_title" label="Current title" error={errors.current_title}>
          <input id="current_title" name="current_title" defaultValue={defaults.current_title} autoComplete="organization-title" />
        </Field>
        <Field id="employer" label="Employer" error={errors.employer}>
          <input id="employer" name="employer" defaultValue={defaults.employer} autoComplete="organization" />
        </Field>
        <Field
          id="place_id"
          label="City and state"
          help={
            !defaults.place_id && defaults.current_city
              ? `Currently ${defaults.current_city}, which isn’t in the city list yet. Leave “Not shared” to keep it.`
              : "Used for “near me” searches and trips."
          }
        >
          <select id="place_id" name="place_id" defaultValue={defaults.place_id}>
            <option value="">Not shared</option>
            {places.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        <Field id="class_year" label="UW–Madison class year" error={errors.class_year}>
          <input id="class_year" name="class_year" type="number" inputMode="numeric" min={1930} defaultValue={defaults.class_year} {...invalid("class_year")} />
        </Field>
        <Field id="industry_id" label="Industry">
          <select id="industry_id" name="industry_id" defaultValue={defaults.industry_id}>
            <option value="">Not specified</option>
            {industries.map((group) => (
              <optgroup key={group.sector} label={group.sector}>
                {group.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
        <Field id="school" label="School or college">
          <input id="school" name="school" defaultValue={defaults.school} placeholder="Wisconsin School of Business" />
        </Field>
        <Field id="degree_major" label="Degree and major" help="For example: BBA, Finance">
          <input id="degree_major" name="degree_major" defaultValue={defaults.degree_major} />
        </Field>
      </div>

      <fieldset style={{ marginTop: 24 }}>
        <legend>Open to</legend>
        <div className="form-grid" style={{ marginTop: 12 }}>
          {Object.entries(OPEN_TO_LABELS).map(([value, label]) => (
            <label key={value} className="checkbox">
              <input type="checkbox" name="open_to" value={value} defaultChecked={defaults.open_to.includes(value)} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <div style={{ marginTop: 24 }}>
        <Field id="bio" label="Professional introduction" help="Your own words. AI summaries are labeled separately." error={errors.bio}>
          <textarea id="bio" name="bio" defaultValue={defaults.bio} maxLength={2000} />
        </Field>
      </div>

      <div className="form-actions">
        <button type="submit" className="btn primary" disabled={pending}>
          {pending ? "Saving…" : "Save profile"}
        </button>
        <Link className="btn" href="/me/privacy">
          Manage contact visibility
        </Link>
      </div>
    </form>
  );
}
