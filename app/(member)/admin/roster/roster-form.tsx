"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Icon } from "@/components/icon";
import type { RosterStatus } from "@/lib/importers/roster";
import { previewRosterFile, type RosterState } from "./actions";

const SHOWN_ROWS = 300;

const STATUS: Record<RosterStatus, { label: string; order: number }> = {
  removed: { label: "Asked to be removed", order: 0 },
  invalid: { label: "Can’t be used", order: 1 },
  duplicate: { label: "Likely duplicate", order: 2 },
  repeat: { label: "Repeated in file", order: 3 },
  new: { label: "New", order: 4 },
};

function Preview({ result }: { result: Extract<RosterState, { status: "preview" }> }) {
  const { preview, fileName, ignoredColumns } = result;
  const total = preview.rows.length;
  // What needs a decision comes first.
  const rows = [...preview.rows].sort((a, b) => STATUS[a.status].order - STATUS[b.status].order || a.row - b.row);
  const statuses = (Object.keys(STATUS) as RosterStatus[]).sort((a, b) => STATUS[a].order - STATUS[b].order);

  return (
    <section className="panel" style={{ marginTop: 24 }}>
      <div className="table-title">
        <div className="section-head" style={{ margin: 0 }}>
          <h2>{fileName}</h2>
          <span className="badge-count">{total} rows</span>
        </div>
        <p className="meta" style={{ marginTop: 8 }}>
          Preview only. Nothing was imported, and this file wasn’t saved.
        </p>
        <div className="od-cluster" style={{ marginTop: 16 }}>
          {statuses
            .filter((s) => preview.counts[s] > 0)
            .map((s) => (
              <span key={s} className="chip subtle">
                {STATUS[s].label}: {preview.counts[s]}
              </span>
            ))}
        </div>
        <div className="detail-list" style={{ marginTop: 16 }}>
          <div className="detail-row">
            <span className="eyebrow">Sources</span>
            <span className="small">
              {Object.entries(preview.sources)
                .map(([source, count]) => `${source} (${count})`)
                .join(" · ") || "None"}
            </span>
          </div>
          <div className="detail-row">
            <span className="eyebrow">Missing</span>
            <span className="small">
              {Object.entries(preview.missing)
                .map(([field, count]) => `${field}: ${count}`)
                .join(" · ") || "Nothing missing"}
            </span>
          </div>
          {ignoredColumns.length > 0 && (
            <div className="detail-row">
              <span className="eyebrow">Ignored columns</span>
              <span className="small">{ignoredColumns.join(", ")}</span>
            </div>
          )}
        </div>
      </div>
      {total > 0 && (
        <div className="table-wrap">
          <table className="responsive">
            <thead>
              <tr>
                <th>Row</th>
                <th>Person</th>
                <th>Result</th>
                <th>Missing</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, SHOWN_ROWS).map((r) => (
                <tr key={r.row}>
                  <td>{r.row}</td>
                  <td>
                    <strong>{r.name || "No name"}</strong>
                    <p className="meta">{[r.email, r.source].filter(Boolean).join(" · ")}</p>
                  </td>
                  <td>
                    <span className={r.status === "new" ? "chip success" : "chip"}>{STATUS[r.status].label}</span>
                    {r.detail && (
                      <p className="meta" style={{ marginTop: 4 }}>
                        {r.matchId ? <Link href={`/people/${r.matchId}`}>{r.detail}</Link> : r.detail}
                      </p>
                    )}
                  </td>
                  <td className="small">{r.missing.join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {total > SHOWN_ROWS && (
        <p className="pad meta">
          Showing the first {SHOWN_ROWS} of {total} rows, most urgent first. The totals above cover every row.
        </p>
      )}
    </section>
  );
}

export function RosterForm() {
  const [state, action, pending] = useActionState<RosterState, FormData>(previewRosterFile, { status: "idle" });
  return (
    <>
      <form action={action} className="panel pad">
        <h2>Preview a roster</h2>
        <p className="small muted" style={{ margin: "12px 0 24px" }}>
          Use a CSV with a Name column, or First name and Last name. Email, Class year, Title, Employer, City, State, LinkedIn and Source are
          read when present.
        </p>
        {state.status === "error" && (
          <div className="notice error" role="alert" style={{ marginBottom: 24 }}>
            <Icon name="info" />
            <div>{state.message}</div>
          </div>
        )}
        <div className="form-grid">
          <div className="field">
            <label htmlFor="source">Where this roster came from</label>
            <input id="source" name="source" maxLength={200} required placeholder="WSB Alumni Relations, November 2026" />
          </div>
          <div className="field">
            <label htmlFor="file">CSV file</label>
            <input id="file" name="file" type="file" accept=".csv,text/csv" required />
          </div>
        </div>
        <label className="checkbox" style={{ marginTop: 16 }}>
          <input type="checkbox" name="authorized" required />
          The institution authorized this roster for Alumni Connect.
        </label>
        <div className="form-actions">
          <button type="submit" className="btn primary" disabled={pending}>
            {pending ? "Checking…" : "Preview roster"}
          </button>
        </div>
      </form>
      {state.status === "preview" && <Preview result={state} />}
    </>
  );
}
