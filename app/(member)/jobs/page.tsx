import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CommunityTabs } from "@/components/community-tabs";
import { Icon } from "@/components/icon";
import { ResultNotice } from "@/components/notice";
import { EmptyState, PageTitle } from "@/components/person";
import { formatDay } from "@/lib/calendar";
import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/viewer";
import { closeJob } from "./actions";

export const metadata: Metadata = { title: "Jobs and referrals" };

const TYPES: Record<string, string> = { full_time: "Full-time", part_time: "Part-time", contract: "Contract", internship: "Internship" };
const RESULTS = {
  posted: { text: "Your job is posted. It stays up for 60 days unless you close it sooner." },
  closed: { text: "The job is closed and no longer shown to members." },
  error: { tone: "error" as const, text: "That couldn’t be saved. Refresh and try again." },
};

interface Job {
  id: string;
  title: string;
  organization_name: string;
  location: string | null;
  is_remote: boolean;
  employment_type: string;
  industry_id: number | null;
  industry_name: string | null;
  description: string | null;
  url: string | null;
  can_refer: boolean;
  expires_on: string;
  created_at: string;
  poster_name: string;
  poster_person_id: string | null;
  is_mine: boolean;
}

async function Jobs({ searchParams }: { searchParams: PageProps<"/jobs">["searchParams"] }) {
  const viewer = await requireMember("/jobs");
  const { q, industry, refer, result } = await searchParams;
  const query = (typeof q === "string" ? q : "").trim().toLowerCase();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("job_board");
  if (error) throw error;
  const all = (data ?? []) as Job[];
  const industries = [...new Map(all.filter((j) => j.industry_id).map((j) => [String(j.industry_id), j.industry_name ?? ""])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const today = all.length ? new Date().toISOString().slice(0, 10) : "";
  const jobs = all.filter(
    (j) =>
      (!query || [j.title, j.organization_name, j.location, j.description].filter(Boolean).join(" ").toLowerCase().includes(query)) &&
      (typeof industry !== "string" || !industry || String(j.industry_id) === industry) &&
      (refer !== "1" || j.can_refer),
  );

  return (
    <>
      <ResultNotice result={result} messages={RESULTS} />
      <form className="filter-row" action="/jobs" role="search" style={{ margin: "0 0 24px" }}>
        <input name="q" defaultValue={typeof q === "string" ? q : ""} placeholder="Title, employer or city" aria-label="Search jobs" style={{ maxWidth: 280 }} />
        <select name="industry" defaultValue={typeof industry === "string" ? industry : ""} aria-label="Industry">
          <option value="">Every industry</option>
          {industries.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <label className="checkbox">
          <input type="checkbox" name="refer" value="1" defaultChecked={refer === "1"} />
          Poster will refer
        </label>
        <button type="submit" className="btn">
          Search
        </button>
        <Link className="btn primary" href="/jobs/new" style={{ marginLeft: "auto" }}>
          <Icon name="plus" /> Post a job
        </Link>
      </form>
      {jobs.length === 0 ? (
        <section className="panel">
          <EmptyState
            title={all.length ? "No jobs match" : "No jobs posted yet"}
            text={all.length ? "Try fewer filters." : "Hiring, or know of an opening at your company? Post it, and say whether you’re willing to refer a fellow Badger."}
            action={
              <Link className="btn primary" href="/jobs/new">
                Post a job
              </Link>
            }
          />
        </section>
      ) : (
        <section className="panel">
          <div className="detail-list">
            {jobs.map((j) => {
              const open = j.expires_on >= today;
              return (
                <div key={j.id} className="detail-row" style={{ padding: 24 }}>
                  <div className="od-cluster" style={{ justifyContent: "space-between" }}>
                    <h3>{j.title}</h3>
                    <span className="od-cluster">
                      {j.can_refer && <span className="chip success">Will refer</span>}
                      {!open && <span className="chip">Expired</span>}
                    </span>
                  </div>
                  <p className="small">
                    {j.organization_name} · {[j.location, j.is_remote && "Remote"].filter(Boolean).join(" · ") || "Location not given"} · {TYPES[j.employment_type]}
                    {j.industry_name ? ` · ${j.industry_name}` : ""}
                  </p>
                  {j.description && <p className="small" style={{ whiteSpace: "pre-wrap" }}>{j.description}</p>}
                  <p className="meta">
                    Posted by {j.poster_person_id ? <Link href={`/people/${j.poster_person_id}`}>{j.poster_name}</Link> : j.poster_name} · {formatDay(j.created_at)}
                  </p>
                  <div className="od-cluster">
                    {!j.is_mine && j.poster_person_id && (
                      <Link
                        className={j.can_refer ? "btn primary" : "btn"}
                        href={`/messages/new?person=${j.poster_person_id}&subject=${encodeURIComponent(`${j.can_refer ? "Referral request" : "Question"}: ${j.title} at ${j.organization_name}`.slice(0, 200))}`}
                      >
                        <Icon name="mail" /> {j.can_refer ? "Ask for a referral" : "Ask about this job"}
                      </Link>
                    )}
                    {j.url && (
                      <a className="btn" href={j.url} target="_blank" rel="noreferrer noopener">
                        View posting
                      </a>
                    )}
                    {(j.is_mine || viewer.isAdmin) && (
                      <form action={closeJob}>
                        <input type="hidden" name="id" value={j.id} />
                        <button type="submit" className="btn quiet">
                          Close this job
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}

export default function JobsPage({ searchParams }: PageProps<"/jobs">) {
  return (
    <>
      <PageTitle
        eyebrow="Community / Jobs and referrals"
        title="Openings where Badgers already work."
        description="Jobs posted by members. Where the poster offers, ask them for a referral in a private message."
      />
      <CommunityTabs />
      <Suspense fallback={<div className="panel pad"><div className="skeleton big" /><div className="skeleton" /><div className="skeleton short" /></div>}>
        <Jobs searchParams={searchParams} />
      </Suspense>
    </>
  );
}
