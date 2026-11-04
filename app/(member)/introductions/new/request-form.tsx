"use client";

import { useActionState } from "react";
import { initialsFor } from "@/lib/labels";
import { Icon } from "@/components/icon";
import { type RequestState, requestIntro } from "../actions";

interface Connector {
  person_id: string;
  full_name: string;
  headline: string | null;
  shared: string;
}

export function RequestForm({ targetId, targetName, connectors, defaultGoal }: { targetId: string; targetName: string; connectors: Connector[]; defaultGoal: string }) {
  const [state, action, pending] = useActionState<RequestState, FormData>(requestIntro, { status: "idle" });
  const values = state.status === "error" && state.values ? state.values : { connector: connectors.length === 1 ? connectors[0].person_id : "", goal: defaultGoal };
  const first = targetName.split(" ")[0];

  return (
    <form key={state.status === "error" ? state.attempt : 0} action={action} className="panel pad" noValidate>
      <input type="hidden" name="target" value={targetId} />
      {state.status === "error" && (
        <div className="notice error" role="alert" style={{ marginBottom: 24 }}>
          <Icon name="info" />
          <div>{state.message}</div>
        </div>
      )}
      <fieldset>
        <legend>Who would you like to ask?</legend>
        <p className="meta" style={{ marginTop: 8 }}>
          Members who know {first} through a shared board or a recorded connection.
        </p>
        <div className="stack" style={{ marginTop: 16, gap: 8 }}>
          {connectors.map((c) => (
            <label key={c.person_id} className="checkbox connector-choice">
              <input type="radio" name="connector" value={c.person_id} defaultChecked={values.connector === c.person_id} required />
              <span className="avatar small" aria-hidden="true">
                {initialsFor(c.full_name)}
              </span>
              <span>
                <strong>{c.full_name}</strong>
                <span className="meta" style={{ display: "block" }}>
                  {[c.headline, `Shared: ${c.shared}`].filter(Boolean).join(" · ")}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="field" style={{ marginTop: 32 }}>
        <label htmlFor="goal">Why would you like to meet?</label>
        <textarea id="goal" name="goal" defaultValue={values.goal} maxLength={1000} required aria-describedby="goal-help" />
        <small id="goal-help">Your connector reads this before deciding, and {first} sees it only if your connector agrees.</small>
      </div>
      <div className="form-actions">
        <button type="submit" className="btn primary" disabled={pending}>
          {pending ? "Sending…" : "Ask for an introduction"}
        </button>
      </div>
      <p className="meta" style={{ marginTop: 16 }}>
        Nobody is connected without agreeing. A request closes after 30 days if no one decides.
      </p>
    </form>
  );
}
