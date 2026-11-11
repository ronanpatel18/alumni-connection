import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { CommunityTabs } from "@/components/community-tabs";
import { Icon } from "@/components/icon";
import { ResultNotice } from "@/components/notice";
import { Avatar, EmptyState, PageTitle } from "@/components/person";
import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/viewer";
import { endMentorship, requestMentorship, respondToMentorship, setOpenToMentoring } from "./actions";

export const metadata: Metadata = { title: "Mentorship" };

const RESULTS = {
  asked: { text: "Request sent. You’ll get an email when they answer." },
  accepted: { text: "You’re now their mentor. Send a message to get started." },
  declined: { text: "Declined. They’ve been told you can’t take on a mentee right now, with no reason given." },
  ended: { text: "The mentorship has ended." },
  open: { text: "You’re listed as open to mentoring. Requests will come to you here and by email." },
  closed: { text: "You’re no longer listed as a mentor. Mentorships you already have continue." },
  error: { tone: "error" as const, text: "That couldn’t be saved. Refresh and try again." },
};

interface Mine {
  id: string;
  goal: string;
  status: "pending" | "accepted" | "declined" | "ended";
  created_at: string;
  i_am_mentor: boolean;
  other_name: string;
  other_person_id: string | null;
}

interface Mentor {
  id: string;
  full_name: string;
  current_title: string | null;
  city: string | null;
  state: string | null;
  status: string;
  photo_url: string | null;
  industry_id: number | null;
  specialties: string[];
  organizations: { name: string } | null;
  industries: { name: string } | null;
  educations: { grad_year: number | null }[];
}

async function Mentorship({ searchParams }: { searchParams: PageProps<"/mentorship">["searchParams"] }) {
  const viewer = await requireMember("/mentorship");
  const { industry, city, result } = await searchParams;
  const supabase = await createClient();
  const [{ data: mineRows }, { data: mentorRows, error }, { data: me }] = await Promise.all([
    supabase.rpc("my_mentorships"),
    supabase
      .from("people")
      .select("id, full_name, current_title, city, state, status, photo_url, industry_id, specialties, organizations:current_organization_id(name), industries:industry_id(name), educations(grad_year)")
      .contains("open_to", ["mentoring"])
      .not("claimed_by_user_id", "is", null)
      .order("full_name")
      .limit(300)
      .returns<Mentor[]>(),
    viewer.personId
      ? supabase.from("people").select("open_to, industry_id, city").eq("id", viewer.personId).maybeSingle<{ open_to: string[]; industry_id: number | null; city: string | null }>()
      : Promise.resolve({ data: null }),
  ]);
  if (error) throw error;
  const mine = (mineRows ?? []) as Mine[];
  const requests = mine.filter((m) => m.i_am_mentor && m.status === "pending");
  const active = mine.filter((m) => m.status === "accepted");
  const asked = mine.filter((m) => !m.i_am_mentor && m.status === "pending");
  const taken = new Set(mine.filter((m) => !m.i_am_mentor && (m.status === "pending" || m.status === "accepted")).map((m) => m.other_person_id));

  const everyone = (mentorRows ?? []).filter((m) => m.id !== viewer.personId);
  const industries = [...new Map(everyone.filter((m) => m.industries).map((m) => [String(m.industry_id), m.industries!.name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const cities = [...new Set(everyone.map((m) => m.city).filter((c): c is string => Boolean(c)))].sort();
  // People in the member's own field and city come first: the likeliest good match.
  const fit = (m: Mentor) => (me?.industry_id && m.industry_id === me.industry_id ? 2 : 0) + (me?.city && m.city === me.city ? 1 : 0);
  const mentors = everyone
    .filter((m) => (typeof industry !== "string" || !industry || String(m.industry_id) === industry) && (typeof city !== "string" || !city || m.city === city))
    .sort((a, b) => fit(b) - fit(a) || a.full_name.localeCompare(b.full_name));
  const openToMentoring = Boolean(me?.open_to.includes("mentoring"));

  return (
    <div className="split">
      <div className="stack">
        <ResultNotice result={result} messages={RESULTS} />
        {requests.length > 0 && (
          <section className="panel">
            <div className="table-title" style={{ paddingBottom: 0 }}>
              <div className="section-head" style={{ margin: 0 }}>
                <h2>Asking you to mentor them</h2>
                <span className="badge-count">{requests.length}</span>
              </div>
            </div>
            <div className="detail-list">
              {requests.map((m) => (
                <div key={m.id} className="detail-row" style={{ padding: "20px 24px" }}>
                  <strong>{m.other_person_id ? <Link href={`/people/${m.other_person_id}`}>{m.other_name}</Link> : m.other_name}</strong>
                  <p className="small" style={{ whiteSpace: "pre-wrap" }}>{m.goal}</p>
                  <div className="od-cluster">
                    <form action={respondToMentorship}>
                      <input type="hidden" name="id" value={m.id} />
                      <input type="hidden" name="decision" value="accept" />
                      <button type="submit" className="btn primary">
                        Agree to mentor
                      </button>
                    </form>
                    <form action={respondToMentorship}>
                      <input type="hidden" name="id" value={m.id} />
                      <input type="hidden" name="decision" value="decline" />
                      <button type="submit" className="btn">
                        Not right now
                      </button>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
        {(active.length > 0 || asked.length > 0) && (
          <section className="panel">
            <div className="table-title" style={{ paddingBottom: 0 }}>
              <h2>Your mentorships</h2>
            </div>
            <div className="detail-list">
              {[...active, ...asked].map((m) => (
                <div key={m.id} className="detail-row" style={{ padding: "20px 24px" }}>
                  <div className="od-cluster" style={{ justifyContent: "space-between" }}>
                    <strong>{m.other_person_id ? <Link href={`/people/${m.other_person_id}`}>{m.other_name}</Link> : m.other_name}</strong>
                    <span className={m.status === "accepted" ? "chip success" : "chip subtle"}>
                      {m.status === "pending" ? "Waiting for their answer" : m.i_am_mentor ? "You mentor them" : "Your mentor"}
                    </span>
                  </div>
                  <p className="small muted" style={{ whiteSpace: "pre-wrap" }}>{m.goal}</p>
                  <div className="od-cluster">
                    {m.status === "accepted" && m.other_person_id && (
                      <>
                        <Link className="btn" href={`/messages/new?person=${m.other_person_id}`}>
                          <Icon name="mail" /> Message
                        </Link>
                        <Link className="btn" href={`/meetings/new?person=${m.other_person_id}`}>
                          <Icon name="calendar" /> Propose a meeting
                        </Link>
                      </>
                    )}
                    <form action={endMentorship}>
                      <input type="hidden" name="id" value={m.id} />
                      <button type="submit" className="btn quiet">
                        {m.status === "pending" ? "Withdraw request" : "End mentorship"}
                      </button>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
        <form className="filter-row" action="/mentorship" style={{ margin: 0 }}>
          <select name="industry" defaultValue={typeof industry === "string" ? industry : ""} aria-label="Industry">
            <option value="">Every industry</option>
            {industries.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <select name="city" defaultValue={typeof city === "string" ? city : ""} aria-label="City">
            <option value="">Every city</option>
            {cities.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <button type="submit" className="btn">
            Show
          </button>
        </form>
        <section className="panel">
          <div className="table-title" style={{ paddingBottom: mentors.length ? 0 : 24 }}>
            <div className="section-head" style={{ margin: 0 }}>
              <h2>Members open to mentoring</h2>
              <span className="badge-count">{mentors.length}</span>
            </div>
          </div>
          {mentors.length === 0 ? (
            <EmptyState
              title={everyone.length ? "No mentors match" : "No one has offered to mentor yet"}
              text={everyone.length ? "Try another industry or city." : "Mentors are members who say they’re open to it. Be the first, or check back as more alumni join."}
            />
          ) : (
            <div className="detail-list">
              {mentors.map((m) => {
                const year = m.educations.map((e) => e.grad_year).filter((y): y is number => Boolean(y)).sort()[0];
                const first = m.full_name.split(" ")[0];
                return (
                  <div key={m.id} className="detail-row" style={{ padding: 24 }}>
                    <div className="od-cluster" style={{ alignItems: "center" }}>
                      <Avatar name={m.full_name} photoUrl={m.photo_url} confirmed size="small" />
                      <div>
                        <Link href={`/people/${m.id}`}>
                          <strong>{m.full_name}</strong>
                        </Link>
                        <p className="meta">
                          {[[m.current_title, m.organizations?.name].filter(Boolean).join(" at "), [m.city, m.state].filter(Boolean).join(", "), year && `Class of ${year}`].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                    </div>
                    {(m.industries || m.specialties.length > 0) && (
                      <div className="od-cluster">
                        {m.industries && <span className="chip subtle">{m.industries.name}</span>}
                        {m.specialties.slice(0, 3).map((s) => (
                          <span key={s} className="chip">
                            {s}
                          </span>
                        ))}
                      </div>
                    )}
                    {taken.has(m.id) ? (
                      <p className="meta">You’ve already asked {first}.</p>
                    ) : viewer.personId ? (
                      <details style={{ border: 0, padding: 0 }}>
                        <summary className="btn" style={{ display: "inline-flex" }}>
                          Ask {first} to mentor you
                        </summary>
                        <ActionForm action={requestMentorship} submitLabel="Send request" pendingLabel="Sending…" className="">
                          <input type="hidden" name="mentor_id" value={m.id} />
                          <div className="field" style={{ marginTop: 16 }}>
                            <label htmlFor={`goal-${m.id}`}>What would you like help with?</label>
                            <textarea id={`goal-${m.id}`} name="goal" rows={3} maxLength={1000} required placeholder="Where you are, what you’re working toward, and why you thought of them." />
                            <small>{first} sees this with your name and decides. A no needs no reason.</small>
                          </div>
                        </ActionForm>
                      </details>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
      <aside className="right-rail stack">
        <section className="panel pad">
          <h2 className="rail-title">{openToMentoring ? "You’re open to mentoring" : "Could you mentor someone?"}</h2>
          {viewer.personId ? (
            <>
              <p className="small muted">
                {openToMentoring
                  ? "Members can ask you here. You choose each one, and you can stop anytime."
                  : "An hour now and then can change the start of someone’s career. You see each request and decide."}
              </p>
              <form action={setOpenToMentoring} className="form-actions" style={{ marginTop: 16 }}>
                <input type="hidden" name="open" value={openToMentoring ? "false" : "true"} />
                <button type="submit" className={openToMentoring ? "btn" : "btn primary"}>
                  {openToMentoring ? "Stop taking requests" : "I’m open to mentoring"}
                </button>
              </form>
            </>
          ) : (
            <>
              <p className="small muted">Mentoring, and asking for a mentor, both need your own profile so the other person knows who you are.</p>
              <div className="form-actions" style={{ marginTop: 16 }}>
                <Link className="btn primary" href="/me">
                  Set up your profile
                </Link>
              </div>
            </>
          )}
        </section>
        <section className="panel pad">
          <h2 className="rail-title">How it works</h2>
          <p className="small muted">
            You ask, they decide. If they agree, you’re connected: you can message, propose a meeting, and see contact details they share
            with connections. Either of you can end it at any time.
          </p>
        </section>
      </aside>
    </div>
  );
}

export default function MentorshipPage({ searchParams }: PageProps<"/mentorship">) {
  return (
    <>
      <PageTitle eyebrow="Community / Mentorship" title="Learn from someone a few steps ahead." description="Members who have offered to mentor fellow alumni. Ask one, or offer your own time." />
      <CommunityTabs />
      <Suspense fallback={<div className="panel pad"><div className="skeleton big" /><div className="skeleton" /><div className="skeleton short" /></div>}>
        <Mentorship searchParams={searchParams} />
      </Suspense>
    </>
  );
}
