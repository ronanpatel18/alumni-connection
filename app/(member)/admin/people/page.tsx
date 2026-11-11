import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminTabs } from "@/components/admin-tabs";
import { Icon } from "@/components/icon";
import { EmptyState, PageTitle } from "@/components/person";
import { searchProviders } from "@/lib/enrichment/providers";
import { LOOKUP_PROVIDER } from "@/lib/enrichment/save-person";
import { formatDegree } from "@/lib/labels";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/viewer";
import { searchAgain } from "./actions";
import { AddPeopleForm, RefreshWhileSearching } from "./add-people-form";

export const metadata: Metadata = { title: "Add people" };
// Where no background queue is reachable, lookups run after the response.
export const maxDuration = 300;

interface JobRow {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "needs_review";
  error: string | null;
  created_at: string;
  people: {
    id: string;
    full_name: string;
    current_title: string | null;
    city: string | null;
    state: string | null;
    status: string;
    organizations: { name: string } | null;
    educations: { degree: string | null; major: string | null; grad_year: number | null }[];
    positions: { id: string }[];
    contact_points: { kind: string; value: string }[];
  };
}

// A lookup takes under a minute; one still open after this long was cut off.
const STALLED_MS = 6 * 60_000;

/** The latest lookup for each person added by name. */
async function loadJobs() {
  const { data, error } = await createAdminClient()
    .from("enrichment_jobs")
    .select(
      "id, status, error, created_at, people!inner(id, full_name, current_title, city, state, status, organizations:current_organization_id(name), " +
        "educations(degree, major, grad_year), positions(id), contact_points(kind, value))",
    )
    .eq("provider", LOOKUP_PROVIDER)
    .order("created_at", { ascending: false })
    .limit(200)
    .returns<JobRow[]>();
  const seen = new Set<string>();
  const jobs = (data ?? []).filter((j) => !seen.has(j.people.id) && seen.add(j.people.id)).slice(0, 60);
  const now = Date.now();
  const isStalled = (j: JobRow) => (j.status === "queued" || j.status === "running") && now - Date.parse(j.created_at) > STALLED_MS;
  const searching = jobs.some((j) => (j.status === "queued" || j.status === "running") && !isStalled(j));
  return { jobs, error, isStalled, searching };
}

function Status({ job, stalled }: { job: JobRow; stalled: boolean }) {
  if (stalled) return <span className="chip">Didn’t finish</span>;
  if (job.status === "queued" || job.status === "running") return <span className="chip ai">Searching…</span>;
  if (job.status === "failed") return <span className="chip">Search failed</span>;
  if (job.status === "succeeded") return <span className="chip success">Found</span>;
  return <span className="chip subtle">Needs a look</span>;
}

async function Added() {
  await requireAdmin("/admin/people");
  const providers = searchProviders();
  const active = providers.filter((p) => p.active);
  const missing = providers.filter((p) => !p.active && p.keyName && p.name !== "tavily");
  const { jobs, error, isStalled, searching } = await loadJobs();

  return (
    <div className="stack">
      {searching && <RefreshWhileSearching />}
      <AddPeopleForm disabled={active.length === 0} />
      <p className="meta">
        {active.length ? `Searching with ${active.map((p) => p.label).join(", ")}.` : "No web search is set up."}
        {missing.length > 0 && ` Not set up: ${missing.map((p) => `${p.label} (${p.keyName})`).join(", ")}.`}
      </p>
      <section className="panel">
        <div className="table-title">
          <div className="section-head" style={{ margin: 0 }}>
            <h2>Added by name</h2>
            <span className="badge-count">{jobs.length}</span>
          </div>
          <p className="meta" style={{ marginTop: 8 }}>
            Only what a public source states is saved. A profile with gaps also appears in Profile review, where you can fill them in.
          </p>
        </div>
        {error ? (
          <div className="pad">
            <div className="notice error" role="alert">
              <Icon name="info" />
              <div>The list couldn’t be loaded. Refresh to try again.</div>
            </div>
          </div>
        ) : jobs.length === 0 ? (
          <EmptyState title="Nobody added yet" text="People you add by name will appear here with what was found for each." />
        ) : (
          <div className="table-wrap">
            <table className="responsive">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Class</th>
                  <th>Work and location</th>
                  <th>Lookup</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => {
                  const p = job.people;
                  const stalled = isStalled(job);
                  const busy = (job.status === "queued" || job.status === "running") && !stalled;
                  const degrees = p.educations.map((e) => [formatDegree(e.degree, e.major), e.grad_year].filter(Boolean).join(" ")).filter(Boolean);
                  const role = [p.current_title, p.organizations?.name].filter(Boolean).join(" at ");
                  const place = [p.city, p.state].filter(Boolean).join(", ");
                  const linkedin = p.contact_points.find((c) => c.kind === "linkedin")?.value;
                  return (
                    <tr key={job.id}>
                      <td data-label="Person">
                        <Link href={`/people/${p.id}`}>
                          <strong>{p.full_name}</strong>
                        </Link>
                        {linkedin && (
                          <p className="meta">
                            <a href={linkedin} target="_blank" rel="noreferrer noopener">
                              LinkedIn
                            </a>
                          </p>
                        )}
                      </td>
                      <td data-label="Class">{degrees.length ? degrees.join("; ") : <span className="muted">{busy ? "…" : "Not found"}</span>}</td>
                      <td data-label="Work and location">
                        {role || <span className="muted">{busy ? "…" : "No current role found"}</span>}
                        <p className="meta">
                          {[place || (busy ? null : "No location found"), p.positions.length > 0 && `${p.positions.length} ${p.positions.length === 1 ? "job" : "jobs"} on file`]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </td>
                      <td data-label="Lookup">
                        <Status job={job} stalled={stalled} />
                        {!busy && job.error && (
                          <p className="meta" style={{ marginTop: 8, maxWidth: "40ch" }}>
                            {job.error}
                          </p>
                        )}
                        {!busy && p.status === "seeded" && (
                          <form action={searchAgain} className="od-cluster" style={{ marginTop: 12 }}>
                            <input type="hidden" name="person_id" value={p.id} />
                            <input name="hint" maxLength={200} aria-label={`Employer, city or class year for ${p.full_name}`} placeholder="Employer, city or year" style={{ maxWidth: 200 }} />
                            <button type="submit" className="btn">
                              Search again
                            </button>
                            <Link className="btn quiet" href={`/admin/review/${p.id}`}>
                              Edit
                            </Link>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default function AddPeoplePage() {
  return (
    <>
      <PageTitle
        eyebrow="Administration / Add people"
        title="Add someone with just their name."
        description="Type a name and the directory builds the profile: UW–Madison class year, work history and location, each read from a public page you can open."
      />
      <AdminTabs />
      <Suspense fallback={<div className="panel pad"><div className="skeleton big" /><div className="skeleton" /><div className="skeleton short" /></div>}>
        <Added />
      </Suspense>
    </>
  );
}
