"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { Icon } from "@/components/icon";
import type { AddResult } from "@/lib/enrichment/save-person";
import { addPeople, type AddPeopleState } from "./actions";

const SKIPPED: Record<Exclude<AddResult["status"], "added">, string> = {
  duplicate: "Already in the directory",
  removed: "Asked to be removed, so not added",
  invalid: "Doesn’t look like a first and last name",
};

export function AddPeopleForm({ disabled }: { disabled: boolean }) {
  const [state, action, pending] = useActionState<AddPeopleState, FormData>(addPeople, { status: "idle" });
  const added = state.status === "done" ? state.results.filter((r) => r.status === "added") : [];
  const skipped = state.status === "done" ? state.results.filter((r) => r.status !== "added") : [];

  return (
    <form action={action} className="panel pad">
      <h2>Add people by name</h2>
      <p className="small muted" style={{ margin: "12px 0 24px" }}>
        One name per line. Each gets a profile right away; their class year, work history and location are then looked up on the public web
        and filled in with the source of each fact.
      </p>
      {state.status === "error" && (
        <div className="notice error" role="alert" style={{ marginBottom: 24 }}>
          <Icon name="info" />
          <div>{state.message}</div>
        </div>
      )}
      {state.status === "done" && (
        <div className={added.length ? "notice success" : "notice"} role="status" style={{ marginBottom: 24 }}>
          <Icon name={added.length ? "check" : "info"} />
          <div>
            {added.length > 0 && (
              <p>
                Added {added.map((r) => r.name).join(", ")}. Looking {added.length === 1 ? "them" : "each of them"} up now; results appear
                below.
              </p>
            )}
            {skipped.map((r) => (
              <p key={`${r.status}:${r.name}`}>
                {r.name}: {SKIPPED[r.status as keyof typeof SKIPPED]}
                {r.status === "duplicate" && (
                  <>
                    {" "}
                    (<Link href={`/people/${r.personId}`}>{r.existingName}</Link>)
                  </>
                )}
                .
              </p>
            ))}
          </div>
        </div>
      )}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="names">Names</label>
          <textarea id="names" name="names" rows={5} required placeholder={"Jane Doe\nJohn Q. Public"} key={state.status === "done" ? added.length : "names"} />
          <small>Up to 25 at a time.</small>
        </div>
        <div className="field">
          <label htmlFor="hint">Anything they have in common (optional)</label>
          <input id="hint" name="hint" maxLength={200} placeholder="Epic Systems, Madison" />
          <small>An employer, a city or a class year helps tell people with the same name apart. It applies to every name above.</small>
        </div>
      </div>
      <div className="form-actions">
        <button type="submit" className="btn primary" disabled={pending || disabled}>
          {pending ? "Adding…" : "Add and look up"}
        </button>
      </div>
    </form>
  );
}

/** Reloads the list every few seconds while lookups are still running. */
export function RefreshWhileSearching() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [router]);
  return null;
}
