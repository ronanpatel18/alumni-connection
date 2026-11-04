"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Icon } from "@/components/icon";
import { degreeFromDetails } from "@/lib/enrichment/linkedin";
import { type LinkedInExport, readLinkedInExport, uwEducations } from "@/lib/linkedin-export";
import { type ImportState, importLinkedIn } from "./actions";

/** Reads the export in the browser; only what the member chooses to import is sent. */
export function ImportForm({ hasProfile }: { hasProfile: boolean }) {
  const [state, action, pending] = useActionState<ImportState, FormData>(importLinkedIn, { status: "idle" });
  const [data, setData] = useState<LinkedInExport | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [useHistory, setUseHistory] = useState(true);
  const [useConnections, setUseConnections] = useState(true);

  async function onFiles(list: FileList | null) {
    setData(null);
    setReadError(null);
    if (!list?.length) return;
    setReading(true);
    try {
      const files = await Promise.all([...list].map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
      setData(readLinkedInExport(files));
    } catch (e) {
      setReadError((e as Error).message);
    } finally {
      setReading(false);
    }
  }

  const uw = data ? uwEducations(data.educations) : [];
  const canHistory = hasProfile && Boolean(data && (data.positions.length || uw.length));
  const canConnections = Boolean(data?.connections.length);
  const payload = data
    ? JSON.stringify({
        history:
          canHistory && useHistory
            ? {
                positions: data.positions.map((p) => ({ title: p.title, company: p.company, start_date: p.startDate, end_date: p.endDate })),
                educations: uw.map((e) => ({ degree: degreeFromDetails(e.degree).degree ?? e.degree, grad_year: e.endYear })),
              }
            : null,
        // Only what matching needs: never emails or messages.
        connections:
          canConnections && useConnections ? data.connections.map((c) => ({ first: c.firstName, last: c.lastName, url: c.url, company: c.company })) : null,
      })
    : "";

  if (state.status === "done") {
    return (
      <section className="panel pad stack">
        <div className="notice success" role="status">
          <Icon name="check" />
          <div>
            <p>
              <strong>Import finished.</strong> Your files weren’t stored.
            </p>
            {hasProfile && (
              <p>
                Work history: {state.addedPositions} added{state.datedPositions ? `, ${state.datedPositions} dated` : ""}. UW degrees:{" "}
                {state.addedDegrees} added{state.datedDegrees ? `, ${state.datedDegrees} given a class year` : ""}.
              </p>
            )}
            {state.checked > 0 && (
              <p>
                {state.matched.length} of your {state.checked} connections {state.matched.length === 1 ? "is" : "are"} in the directory.
              </p>
            )}
          </div>
        </div>
        {state.matched.length > 0 && (
          <div className="od-cluster">
            {state.matched.map((p) => (
              <Link key={p.id} className="chip" href={`/people/${p.id}`}>
                {p.name}
              </Link>
            ))}
          </div>
        )}
        {hasProfile && (
          <p className="small muted">
            Review your profile in <Link href="/me">Edit profile</Link>; your own edits always come first.
          </p>
        )}
      </section>
    );
  }

  return (
    <form action={action} className="panel pad stack">
      <div className="field">
        <label htmlFor="export">Your LinkedIn export</label>
        <input id="export" type="file" accept=".zip,.csv" multiple onChange={(e) => onFiles(e.target.files)} aria-describedby="export-help" />
        <small id="export-help">The ZIP LinkedIn emails you, or its Connections.csv, Positions.csv and Education.csv. It’s read here in your browser.</small>
      </div>
      {reading && <p className="meta" role="status">Reading your export…</p>}
      {readError && (
        <div className="notice error" role="alert">
          <Icon name="info" />
          <div>{readError}</div>
        </div>
      )}
      {state.status === "error" && (
        <div className="notice error" role="alert">
          <Icon name="info" />
          <div>{state.message}</div>
        </div>
      )}

      {data && (
        <>
          <div className="notice">
            <Icon name="file" />
            <div>
              <p>
                <strong>Found:</strong> {data.files.join(", ")}
              </p>
              <p>
                {data.positions.length} positions · {uw.length} UW–Madison {uw.length === 1 ? "degree" : "degrees"} ·{" "}
                {data.connections.length} connections
              </p>
            </div>
          </div>

          <fieldset className="stack" style={{ gap: 8 }}>
            <legend>What to import</legend>
            <label className="checkbox">
              <input type="checkbox" checked={canHistory && useHistory} disabled={!canHistory} onChange={(e) => setUseHistory(e.target.checked)} />
              <span>
                Add my work history and UW–Madison {uw.length === 1 ? "degree" : "degrees"} to my profile
                <span className="meta" style={{ display: "block" }}>
                  {hasProfile
                    ? "Adds jobs and dates you don’t have yet. Your current role and anything you’ve edited stay as they are."
                    : "Claim your profile first to add your own history."}
                </span>
              </span>
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={canConnections && useConnections} disabled={!canConnections} onChange={(e) => setUseConnections(e.target.checked)} />
              <span>
                Find people I already know
                <span className="meta" style={{ display: "block" }}>
                  Sends only names, employers and LinkedIn links to match against the directory. Matches are visible only to you; the rest
                  are discarded. A new import replaces the last.
                </span>
              </span>
            </label>
          </fieldset>

          <input type="hidden" name="payload" value={payload} />
          <div className="form-actions">
            <button type="submit" className="btn primary" disabled={pending || !((canHistory && useHistory) || (canConnections && useConnections))}>
              {pending ? "Importing…" : "Import"}
            </button>
          </div>
        </>
      )}
    </form>
  );
}
