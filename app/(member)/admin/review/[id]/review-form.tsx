"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Icon } from "@/components/icon";
import { ALUMNI_STATUS_LABELS, REVIEW_REASON_LABELS } from "@/lib/labels";
import { type ReviewState, reviewProfile } from "../../actions";

export interface ReviewDefaults {
  person_id: string;
  full_name: string;
  current_title: string;
  employer: string;
  city: string;
  state: string;
  industry_id: string;
  alumni_status: string;
  educations: { id: string; degree: string; major: string; school: string; grad_year: string }[];
}

interface IndustryGroup {
  sector: string;
  options: { value: string; label: string }[];
}

function Field({ id, label, error, help, children }: { id: string; label: string; error?: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {help && <small>{help}</small>}
      {error && (
        <span className="error-text" id={`${id}-error`}>
          {error}
        </span>
      )}
    </div>
  );
}

export function ReviewForm({ defaults, reasons, industries }: { defaults: ReviewDefaults; reasons: string[]; industries: IndustryGroup[] }) {
  const [state, action, pending] = useActionState<ReviewState, FormData>(reviewProfile, { status: "idle" });
  const errors = state.status === "error" ? (state.fields ?? {}) : {};
  const err = (key: string) => (errors[key] ? { "aria-invalid": true, "aria-describedby": `${key}-error` } : {});
  // Existing degrees plus one blank row for a degree the sources mention but we don't have.
  const educations = [...defaults.educations, { id: "", degree: "", major: "", school: "", grad_year: "" }];

  return (
    <form action={action} className="stack" noValidate>
      <input type="hidden" name="person_id" value={defaults.person_id} />
      {state.status === "error" && (
        <div className="notice error" role="alert">
          <Icon name="info" />
          <div>{state.message}</div>
        </div>
      )}

      {reasons.length > 0 && (
        <div className="notice" role="note">
          <Icon name="info" />
          <div>
            <p>
              <strong>Needs review:</strong> {reasons.map((r) => REVIEW_REASON_LABELS[r] ?? r).join(" · ")}
            </p>
            <p>Only fill in what a source supports. Leave a field blank rather than guess.</p>
          </div>
        </div>
      )}

      <section className="panel pad">
        <h2 style={{ marginBottom: 24 }}>Role & location</h2>
        <div className="form-grid">
          <div className="full">
            <Field id="full_name" label="Full name" error={errors.full_name}>
              <input id="full_name" name="full_name" defaultValue={defaults.full_name} required autoComplete="off" {...err("full_name")} />
            </Field>
          </div>
          <Field id="current_title" label="Current title">
            <input id="current_title" name="current_title" defaultValue={defaults.current_title} autoComplete="off" />
          </Field>
          <Field id="employer" label="Employer">
            <input id="employer" name="employer" defaultValue={defaults.employer} autoComplete="off" />
          </Field>
          <Field id="city" label="City">
            <input id="city" name="city" defaultValue={defaults.city} autoComplete="off" />
          </Field>
          <Field id="state" label="State" error={errors.state} help="Two letters, such as WI. Leave blank outside the US.">
            <input id="state" name="state" defaultValue={defaults.state} maxLength={2} autoComplete="off" {...err("state")} />
          </Field>
          <div className="full">
            <Field id="industry_id" label="Industry">
              <select id="industry_id" name="industry_id" defaultValue={defaults.industry_id}>
                <option value="">Not set</option>
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
          </div>
        </div>
      </section>

      <section className="panel pad">
        <h2 style={{ marginBottom: 8 }}>UW–Madison education</h2>
        <p className="small muted" style={{ marginBottom: 24 }}>
          Clear every box in a row to delete it. Use the empty row to add a degree a source mentions.
        </p>
        <div className="field" style={{ marginBottom: 24 }}>
          <label htmlFor="alumni_status">Alumni status</label>
          <select id="alumni_status" name="alumni_status" defaultValue={defaults.alumni_status}>
            {Object.entries(ALUMNI_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="stack">
          {educations.map((e, i) => (
            <fieldset key={e.id || "new"} className="form-grid edu-row">
              <legend className="full">{e.id ? `Degree ${i + 1}` : "Add a degree"}</legend>
              <input type="hidden" name="edu_id" value={e.id} />
              <Field id={`edu_degree_${i}`} label="Degree">
                <input id={`edu_degree_${i}`} name="edu_degree" defaultValue={e.degree} placeholder="BBA, MBA, BA…" autoComplete="off" />
              </Field>
              <Field id={`edu_year_${i}`} label="Class year" error={errors[`edu_year_${i}`]}>
                <input
                  id={`edu_year_${i}`}
                  name="edu_year"
                  defaultValue={e.grad_year}
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="e.g. 1998"
                  autoComplete="off"
                  {...err(`edu_year_${i}`)}
                />
              </Field>
              <Field id={`edu_major_${i}`} label="Major">
                <input id={`edu_major_${i}`} name="edu_major" defaultValue={e.major} autoComplete="off" />
              </Field>
              <Field id={`edu_school_${i}`} label="School or college">
                <input id={`edu_school_${i}`} name="edu_school" defaultValue={e.school} placeholder="Wisconsin School of Business" autoComplete="off" />
              </Field>
            </fieldset>
          ))}
        </div>
      </section>

      <section className="panel pad">
        <Field id="note" label="Review note" error={errors.note} help="What you checked and where, e.g. “Class year from the 1998 commencement program.” Kept in the review log.">
          <textarea id="note" name="note" maxLength={2000} required {...err("note")} />
        </Field>
        <div className="form-actions">
          <button type="submit" className="btn primary" disabled={pending}>
            {pending ? "Saving…" : "Save review"}
          </button>
          <Link className="btn quiet" href="/admin/review">
            Back to the queue
          </Link>
        </div>
      </section>
    </form>
  );
}
