"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Icon } from "@/components/icon";
import { OPEN_TO_LABELS } from "@/lib/labels";
import { confirmProfile, type WelcomeState } from "./actions";

export interface WelcomeDefaults {
  personId: string;
  current_title: string;
  employer: string;
  place_id: string;
  current_city: string;
  open_to: string[];
}

export function WelcomeForm({ defaults, places }: { defaults: WelcomeDefaults; places: { value: string; label: string }[] }) {
  const [state, action, pending] = useActionState<WelcomeState, FormData>(confirmProfile, { status: "idle" });
  return (
    <form action={action} className="narrow panel pad">
      {state.status === "error" && (
        <div className="notice error" role="alert" style={{ marginBottom: 24 }}>
          <Icon name="info" />
          <div>{state.message}</div>
        </div>
      )}
      <h2>Is this still right?</h2>
      <div className="form-grid" style={{ marginTop: 16 }}>
        <div className="field">
          <label htmlFor="current_title">Role</label>
          <input id="current_title" name="current_title" defaultValue={defaults.current_title} maxLength={200} />
        </div>
        <div className="field">
          <label htmlFor="employer">Employer</label>
          <input id="employer" name="employer" defaultValue={defaults.employer} maxLength={200} />
        </div>
        <div className="field">
          <label htmlFor="place_id">City</label>
          <select id="place_id" name="place_id" defaultValue={defaults.place_id}>
            <option value="">Not shared</option>
            {places.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          {!defaults.place_id && defaults.current_city && (
            <small>Currently {defaults.current_city}, which isn’t in the city list yet. Leave “Not shared” to keep it.</small>
          )}
        </div>
      </div>

      <fieldset style={{ marginTop: 24 }}>
        <legend>What are you open to?</legend>
        <div className="form-grid" style={{ marginTop: 12 }}>
          {Object.entries(OPEN_TO_LABELS).map(([value, label]) => (
            <label key={value} className="checkbox">
              <input type="checkbox" name="open_to" value={value} defaultChecked={defaults.open_to.includes(value)} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="notice" style={{ marginTop: 24 }}>
        <Icon name="lock" />
        <div>
          <p className="small">
            Contact details on your profile are visible to all verified members. Review them in{" "}
            <Link href="/me/privacy">Profile &amp; privacy</Link>; leave a field blank to keep it off your profile.
          </p>
        </div>
      </div>

      <div className="form-actions">
        <button type="submit" className="btn primary" disabled={pending}>
          {pending ? "Saving…" : "Save and see my profile"}
        </button>
        <Link className="btn quiet" href={`/people/${defaults.personId}?claimed=1`}>
          Skip for now
        </Link>
      </div>
    </form>
  );
}
