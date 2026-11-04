"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Icon } from "@/components/icon";
import { saveTrip, type TripFormState } from "./actions";

export interface TripDefaults {
  trip_id: string;
  place_id: string;
  starts_on: string;
  ends_on: string;
  industry_slugs: string[];
  goal: string;
}

interface Option {
  value: string;
  label: string;
}

export function TripForm({ defaults, places, sectors }: { defaults: TripDefaults; places: Option[]; sectors: Option[] }) {
  const [state, action, pending] = useActionState<TripFormState, FormData>(saveTrip, { status: "idle" });
  const errors = state.status === "error" ? (state.fields ?? {}) : {};
  // React resets a form after its action runs; refill it with what was submitted.
  const values = state.status === "error" && state.values ? { ...defaults, ...state.values } : defaults;
  const formKey = state.status === "error" ? state.attempt : 0;
  const err = (key: string) => (errors[key] ? { "aria-invalid": true, "aria-describedby": `${key}-error` } : {});
  const fieldError = (key: string) =>
    errors[key] ? (
      <span className="error-text" id={`${key}-error`}>
        {errors[key]}
      </span>
    ) : null;

  return (
    <form key={formKey} action={action} className="panel pad" noValidate>
      <input type="hidden" name="trip_id" value={defaults.trip_id} />
      {state.status === "error" && (
        <div className="notice error" role="alert" style={{ marginBottom: 24 }}>
          <Icon name="info" />
          <div>{state.message}</div>
        </div>
      )}
      <div className="form-grid">
        <div className="field full">
          <label htmlFor="place_id">Destination city</label>
          <select id="place_id" name="place_id" defaultValue={values.place_id} required {...err("place_id")}>
            <option value="">Choose a city</option>
            {places.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <small>We look for alumni within 50 miles.</small>
          {fieldError("place_id")}
        </div>
        <div className="field">
          <label htmlFor="starts_on">Arrival date</label>
          <input id="starts_on" name="starts_on" type="date" defaultValue={values.starts_on} required {...err("starts_on")} />
          {fieldError("starts_on")}
        </div>
        <div className="field">
          <label htmlFor="ends_on">Departure date</label>
          <input id="ends_on" name="ends_on" type="date" defaultValue={values.ends_on} required {...err("ends_on")} />
          {fieldError("ends_on")}
        </div>
      </div>

      <fieldset style={{ marginTop: 32 }} aria-describedby={errors.industry_slugs ? "industry_slugs-error" : undefined}>
        <legend>Industries you’d like to meet</legend>
        <p className="meta" style={{ marginTop: 8 }}>
          Choose one or more. You can change them later.
        </p>
        <div className="form-grid" style={{ marginTop: 12, gap: "0 24px" }}>
          {sectors.map((s) => (
            <label key={s.value} className="checkbox">
              <input type="checkbox" name="industry_slugs" value={s.value} defaultChecked={values.industry_slugs.includes(s.value)} />
              {s.label}
            </label>
          ))}
        </div>
        {fieldError("industry_slugs")}
      </fieldset>

      <div className="field" style={{ marginTop: 32 }}>
        <label htmlFor="goal">What’s your goal for this trip?</label>
        <textarea id="goal" name="goal" defaultValue={values.goal} maxLength={1000} required aria-describedby="goal-help" {...err("goal")} />
        <small id="goal-help">Be specific: a partnership, a perspective on the market, or a career conversation.</small>
        {fieldError("goal")}
      </div>

      <div className="form-actions">
        <button type="submit" className="btn primary" disabled={pending}>
          {pending ? "Saving…" : defaults.trip_id ? "Save and see people" : "Find people to meet"} <Icon name="arrow" />
        </button>
        <Link className="btn quiet" href={defaults.trip_id ? `/trips/${defaults.trip_id}` : "/trips"}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
