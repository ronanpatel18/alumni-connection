"use client";

import { useActionState } from "react";
import { Icon } from "@/components/icon";
import { removeProfile, type RemoveState } from "./actions";

export const REMOVED_NOTICE =
  "Your profile has been removed. A minimal suppression record prevents it from being added again.";

export function RemoveForm({ token, name, subtitle }: { token: string; name: string; subtitle: string | null }) {
  const [state, action, pending] = useActionState<RemoveState, FormData>(() => removeProfile(token), { status: "idle" });

  if (state.status === "removed") {
    return (
      <div className="notice success" role="status">
        <Icon name="check" />
        <div>{REMOVED_NOTICE}</div>
      </div>
    );
  }

  return (
    <form action={action}>
      <h2>
        {name}
        {subtitle ? ` · ${subtitle}` : ""}
      </h2>
      <p className="small muted" style={{ marginTop: 16 }}>
        Removing this record deletes it from member search and introductions, along with its contact details and any
        notes members kept about it. It won’t be re-added by future imports.
      </p>
      <p className="small muted" style={{ marginTop: 16 }}>
        A minimal suppression record is kept only to honor your request. This can’t be undone, but you can always join
        later by signing up.
      </p>
      {state.status === "error" && (
        <div className="notice error" role="alert" style={{ marginTop: 16 }}>
          <Icon name="info" />
          <div>{state.message}</div>
        </div>
      )}
      <div className="form-actions">
        <button type="submit" className="btn danger" disabled={pending}>
          {pending ? "Removing…" : "Remove my profile now"}
        </button>
      </div>
    </form>
  );
}
