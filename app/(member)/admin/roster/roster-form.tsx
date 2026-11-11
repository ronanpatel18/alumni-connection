"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Icon } from "@/components/icon";
import type { RosterStatus } from "@/lib/importers/roster";
import { importRoster, previewRosterFile, type RosterState } from "./actions";

const SHOWN_ROWS = 300;

const STATUS: Record<RosterStatus, { label: string; order: number }> = {
  removed: { label: "Asked to be removed", order: 0 },
  invalid: { label: "Can’t be used", order: 1 },
  duplicate: { label: "Likely duplicate", order: 2 },
  repeat: { label: "Repeated in file", order: 3 },
  new: { label: "New", order: 4 },
};

function ImportForm({ result, action, pending }: { result: Extract<RosterState, { status: "preview" }>; action: (data: FormData) => void; pending: boolean }) {
  const count = result.importable.length;
  const gaps = Object.values(result.preview.missing).some((n) => n > 0);
  if (!count) {
    return (
      <div className="notice" style={{ marginTop: 24 }}>
        <Icon name="info" />
        <div>Nothing to import: no row in this file is new.</div>
      </div>
    );
  }
  return (
    <form action={action} className="panel pad" style={{ marginTop: 24 }}>
      <h2>
        Import {count} new {count === 1 ? "person" : "people"}
      </h2>
      <p className="small muted" style={{ margin: "12px 0 16px" }}>
        Only rows marked New are added. Duplicates, repeats, rows without a name and anyone who asked to be removed are left out. Each new
        profile is marked as a confirmed alum from this roster; roster emails stay private and are used only to match a claim.
      </p>
      <input type="hidden" name="rows" value={JSON.stringify(result.importable)} />
      <input type="hidden" name="source" value={result.source} />
      <input type="hidden" name="authorized" value="on" />
      {gaps && (
        <label className="checkbox">
          <input type="checkbox" name="lookup" defaultChecked />
          Look up missing class years, roles and locations on the web (first 25 people with gaps)
        </label>
      )}
      <div className="form-actions">
        <button type="submit" className="btn primary" disabled={pending}>
          {pending ? "Importing…" : `Import ${count} ${count === 1 ? "person" : "people"}`}
        </button>
      </div>
    </form>
  );
}

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
          Preview only. Nothing has been imported yet, and this file wasn’t saved.
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
  const [previewState, action, pending] = useActionState<RosterState, FormData>(previewRosterFile, { status: "idle" });
  const [importState, importAction, importing] = useActionState<RosterState, FormData>(importRoster, { status: "idle" });
  // The newest result wins: an import replaces the preview it came from.
  const state = importState.status === "idle" || pending ? previewState : importState;
  if (state.status === "imported") {
    return (
      <div className="panel pad">
        <div className="notice success" role="status">
          <Icon name="check" />
          <div>
            <p>
              Imported {state.imported} {state.imported === 1 ? "person" : "people"}.
              {state.skipped > 0 && ` ${state.skipped} ${state.skipped === 1 ? "row was" : "rows were"} no longer new and left out.`}
            </p>
            {state.lookedUp > 0 && (
              <p>
                Looking up missing details for {state.lookedUp}. Follow them under <Link href="/admin/people">Add people</Link>.
              </p>
            )}
          </div>
        </div>
        <div className="form-actions">
          <Link className="btn primary" href="/admin/review">
            Review new profiles
          </Link>
          <a className="btn" href="/admin/roster">
            Import another roster
          </a>
        </div>
      </div>
    );
  }
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
      {state.status === "preview" && (
        <>
          <ImportForm result={state} action={importAction} pending={importing} />
          <Preview result={state} />
        </>
      )}
    </>
  );
}
