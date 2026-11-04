import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BackToSearch } from "@/components/back-to-search";
import { DialogButton } from "@/components/dialog-button";
import { Icon } from "@/components/icon";
import { Avatar, LinkedInLink, OPEN_TO_LABELS, PageTitle, SaveButton, StatusBadge, isConfirmed } from "@/components/person";
import { formatDegree } from "@/lib/labels";
import { FIELD_LABELS, SOURCE_LABELS } from "@/lib/provenance";
import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/viewer";
import { addNote } from "./actions";

export const metadata: Metadata = { title: "Alumni profile" };

interface ContactPoint {
  id: string;
  kind: string;
  value: string;
  source: string;
  visibility: string;
  verified_at: string | null;
}

interface ProfileRow {
  id: string;
  full_name: string;
  first_name: string | null;
  headline: string | null;
  bio: string | null;
  ai_summary: string[] | null;
  current_title: string | null;
  city: string | null;
  state: string | null;
  metro: string | null;
  status: string;
  alumni_status: string;
  claimed_by_user_id: string | null;
  photo_url: string | null;
  open_to: string[];
  specialties: string[];
  organizations: { name: string } | null;
  industries: { name: string } | null;
  educations: { id: string; school: string | null; degree: string | null; major: string | null; grad_year: number | null }[];
  positions: { id: string; title: string; organization_name: string; is_current: boolean; start_date: string | null; end_date: string | null }[];
  contact_points: ContactPoint[];
  group_memberships: { groups: { slug: string; name: string } | null }[];
  field_provenance: { field: string; source: string; source_url: string | null; fetched_at: string }[];
}

const CONTACT_KINDS = [
  { kind: "email", label: "Email" },
  { kind: "phone", label: "Phone" },
  { kind: "website", label: "Website" },
  { kind: "linkedin", label: "LinkedIn" },
] as const;

const year = (date: string | null) => (date ? date.slice(0, 4) : null);

function visibilityNote(point: ContactPoint) {
  const reason =
    point.visibility === "connections"
      ? "Visible because you’re connected"
      : point.visibility === "private"
        ? "Visible to you as an administrator"
        : "Visible to verified members";
  return `${reason} · ${SOURCE_LABELS[point.source] ?? point.source}`;
}

/** Members who could introduce you (shared board or recorded connection), and the way to ask. */
async function WarmIntro({ personId, firstName, isMe }: { personId: string; firstName: string; isMe: boolean }) {
  if (isMe) return null;
  const supabase = await createClient();
  const { data } = await supabase.rpc("intro_connectors", { p_target: personId });
  const connectors = (data ?? []) as { person_id: string; full_name: string; shared: string }[];
  return (
    <section className="panel pad">
      <h2 className="rail-title">A warmer introduction</h2>
      {connectors.length ? (
        <>
          <div className="detail-list">
            {connectors.slice(0, 3).map((c) => (
              <div key={c.person_id} className="detail-row">
                <strong className="small">{c.full_name}</strong>
                <span className="meta">Shared: {c.shared}</span>
              </div>
            ))}
          </div>
          <div className="form-actions">
            <Link className="btn" href={`/introductions/new?person=${personId}`}>
              Ask for an introduction
            </Link>
          </div>
        </>
      ) : (
        <p className="small muted">
          No member who knows {firstName} has joined yet. Start with a brief, thoughtful message, or check back once someone on their board
          claims their profile.
        </p>
      )}
    </section>
  );
}

async function Profile({ params, searchParams }: { params: PageProps<"/people/[id]">["params"]; searchParams: PageProps<"/people/[id]">["searchParams"] }) {
  const { id } = await params;
  const { claimed: justClaimed } = await searchParams;
  const viewer = await requireMember(`/people/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await createClient();
  const [{ data: person }, { data: saved }, { data: notes }, { data: knownOnLinkedIn }] = await Promise.all([
    supabase
      .from("people")
      .select(
        "id, full_name, first_name, headline, bio, ai_summary, current_title, city, state, metro, status, alumni_status, claimed_by_user_id, photo_url, open_to, specialties, " +
          "organizations:current_organization_id(name), industries:industry_id(name), " +
          "educations(id, school, degree, major, grad_year), " +
          "positions(id, title, organization_name, is_current, start_date, end_date), " +
          "contact_points(id, kind, value, source, visibility, verified_at), group_memberships(groups(slug, name)), " +
          "field_provenance(field, source, source_url, fetched_at)",
      )
      .eq("id", id)
      .maybeSingle<ProfileRow>(),
    supabase.from("saved_contacts").select("person_id").eq("owner_user_id", viewer.userId).eq("person_id", id).maybeSingle(),
    supabase
      .from("notes")
      .select("id, body, created_at")
      .eq("person_id", id)
      .order("created_at", { ascending: false })
      .returns<{ id: string; body: string; created_at: string }[]>(),
    // From the member's own LinkedIn import; visible only to them.
    supabase.from("my_connections").select("person_id").eq("owner_user_id", viewer.userId).eq("person_id", id).maybeSingle(),
  ]);
  if (!person) notFound();

  const confirmed = isConfirmed(person.status);
  const firstName = person.first_name ?? person.full_name.split(" ")[0];
  const market = person.metro ?? (person.city ? [person.city, person.state].filter(Boolean).join(", ") : null);
  // Skip empty education rows (no degree, major or year): they carry no information.
  const educations = person.educations
    .filter((e) => e.degree || e.major || e.grad_year)
    .sort((a, b) => (a.grad_year ?? 9999) - (b.grad_year ?? 9999));
  const firstYear = educations.find((e) => e.grad_year)?.grad_year;
  // Main job first (the one in their headline), then other current roles, then past jobs, newest first.
  const isMain = (p: ProfileRow["positions"][number]) =>
    p.is_current && p.title === person.current_title && (!person.organizations || p.organization_name === person.organizations.name);
  const positions = [...person.positions].sort(
    (a, b) =>
      Number(isMain(b)) - Number(isMain(a)) ||
      Number(b.is_current) - Number(a.is_current) ||
      (b.start_date ?? "").localeCompare(a.start_date ?? ""),
  );
  // Some listings give only a role or only an employer, which isn't enough for a
  // position record; show what's known as the current entry instead.
  const currentOnlyOnProfile =
    positions.length === 0 && (person.current_title || person.organizations?.name)
      ? { title: person.current_title ?? "Role not listed", organization: person.organizations?.name ?? "Employer not listed" }
      : null;
  const groups = person.group_memberships.map((m) => m.groups).filter((g): g is { slug: string; name: string } => Boolean(g));
  const bioSource = person.field_provenance.find((p) => p.field === "bio");
  const linkedin = person.contact_points.find((p) => p.kind === "linkedin");

  return (
    <>
      <BackToSearch />
      <PageTitle eyebrow="Discover / Alumni profile" />
      {justClaimed === "1" && person.claimed_by_user_id === viewer.userId && (
        <div className="notice success" role="status" style={{ marginBottom: 24 }}>
          <Icon name="check" />
          <div>
            <p>
              <strong>This is now your profile.</strong> It shows as confirmed to other members. Review the details below; anything you
              change replaces what came from public sources.
            </p>
          </div>
        </div>
      )}
      <section className="profile-heading" style={{ marginBottom: 32 }}>
        <Avatar name={person.full_name} photoUrl={person.photo_url} confirmed={confirmed} size="large" />
        <div className="identity">
          <div className="od-cluster">
            <StatusBadge status={person.status} />
            {knownOnLinkedIn && (
              <span className="chip" title="From your LinkedIn import. Only you can see this.">
                <Icon name="linkedin" /> In your LinkedIn connections
              </span>
            )}
          </div>
          <h1>{person.full_name}</h1>
          <p>
            {person.current_title ?? "Role not provided"} · {person.organizations?.name ?? "Employer not provided"}
          </p>
          <p className="small muted" style={{ marginTop: 8 }}>
            <Icon name="pin" /> {market ?? "Location not provided"}
            {person.alumni_status !== "not_alumnus" && (
              <>
                <span style={{ padding: "0 8px" }}>·</span>
                <Icon name="calendar" /> {firstYear ? `UW–Madison, Class of ${firstYear}` : "UW–Madison · class year not confirmed"}
              </>
            )}
          </p>
        </div>
        <div className="od-cluster">
          {/* Members (claimed profiles) can be messaged privately; others through details they've shared. */}
          {confirmed && person.claimed_by_user_id !== viewer.userId && (
            <Link className="btn primary" href={`/messages/new?person=${person.id}`}>
              <Icon name="mail" /> Send a message
            </Link>
          )}
          {linkedin && <LinkedInLink name={person.full_name} url={linkedin.value} withText />}
          <SaveButton personId={person.id} name={person.full_name} saved={Boolean(saved)} withText />
        </div>
      </section>

      <div className="split">
        <div className="stack">
          {person.ai_summary?.length ? (
            <section className="panel pad">
              <div className="section-head">
                <h2>At a glance</h2>
                <span className="chip ai">AI-generated summary</span>
              </div>
              <ul className="glance-list">
                {person.ai_summary.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <p className="meta" style={{ marginTop: 16 }}>
                AI can miss context. Review the experience and source details below.
              </p>
            </section>
          ) : null}

          {person.bio && (
            <section className="panel pad">
              <div className="section-head">
                <h2>About</h2>
                {bioSource && <span className="chip subtle">{SOURCE_LABELS[bioSource.source] ?? bioSource.source}</span>}
              </div>
              <p className="bio">{person.bio}</p>
            </section>
          )}

          <section className="panel pad">
            <h2 style={{ marginBottom: 24 }}>Experience & education</h2>
            <div className="timeline">
              {positions.map((p) => (
                <div key={p.id} className="timeline-item">
                  <span className="timeline-dot" />
                  <div>
                    <h3>{p.title}</h3>
                    <p>
                      {p.organization_name} ·{" "}
                      {p.is_current
                        ? p.start_date
                          ? `${year(p.start_date)}–present`
                          : "Current"
                        : [year(p.start_date), year(p.end_date)].filter(Boolean).join("–") || "Past"}
                    </p>
                  </div>
                </div>
              ))}
              {currentOnlyOnProfile && (
                <div className="timeline-item">
                  <span className="timeline-dot" />
                  <div>
                    <h3>{currentOnlyOnProfile.title}</h3>
                    <p>{currentOnlyOnProfile.organization} · Current</p>
                  </div>
                </div>
              )}
              {positions.length === 0 && !currentOnlyOnProfile && (
                <div className="timeline-item">
                  <span className="timeline-dot" />
                  <div>
                    <h3>Experience</h3>
                    <p>Experience not provided yet.</p>
                  </div>
                </div>
              )}
              {person.alumni_status !== "not_alumnus" && (
                <div className="timeline-item">
                  <span className="timeline-dot" />
                  <div>
                    <h3>University of Wisconsin–Madison</h3>
                    {educations.length ? (
                      educations.map((e) => (
                        <p key={e.id}>
                          <strong className="grad-year">{e.grad_year ? `Class of ${e.grad_year}` : "Class year not confirmed"}</strong>
                          {[formatDegree(e.degree, e.major), e.school].filter(Boolean).map((part) => ` · ${part}`)}
                        </p>
                      ))
                    ) : (
                      <p>Degree and class year not yet confirmed.</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>

          {groups.length > 0 && (
            <section className="panel pad">
              <div className="section-head">
                <h2>Groups</h2>
              </div>
              <div className="od-cluster">
                {groups.map((g) => (
                  <Link key={g.slug} className="chip" href={`/search?group=${g.slug}`}>
                    {g.name}
                  </Link>
                ))}
              </div>
            </section>
          )}

          <section className="panel pad">
            <div className="section-head">
              <h2>Open to connecting</h2>
            </div>
            {person.open_to.length ? (
              <div className="od-cluster">
                {person.open_to.map((t) => (
                  <span key={t} className="chip">
                    {OPEN_TO_LABELS[t] ?? t}
                  </span>
                ))}
              </div>
            ) : (
              <p className="small muted">
                {confirmed ? `${firstName} hasn’t shared preferences yet.` : "Preferences appear once this person claims their profile."}
              </p>
            )}
          </section>

          <section className="panel pad">
            <div className="section-head">
              <h2>Your private notes</h2>
              <span className="chip">
                <Icon name="lock" />
                Only you
              </span>
            </div>
            <form action={addNote}>
              <input type="hidden" name="personId" value={person.id} />
              <div className="field">
                <label htmlFor="private-note">Notes about {person.full_name}</label>
                <textarea id="private-note" name="body" maxLength={5000} required />
                <small>These notes are never shown to this person or other members.</small>
              </div>
              <div className="form-actions">
                <button type="submit" className="btn primary">
                  Save note
                </button>
              </div>
            </form>
            {notes && notes.length > 0 && (
              <div className="detail-list" style={{ marginTop: 24 }}>
                {notes.map((n) => (
                  <div key={n.id} className="detail-row">
                    <p className="small bio">{n.body}</p>
                    <span className="meta">{new Date(n.created_at).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="right-rail stack">
          <Suspense
            fallback={
              <section className="panel pad">
                <h2 className="rail-title">A warmer introduction</h2>
                <div className="skeleton" />
              </section>
            }
          >
            <WarmIntro personId={person.id} firstName={firstName} isMe={person.claimed_by_user_id === viewer.userId} />
          </Suspense>

          <section className="panel pad">
            <h2 className="rail-title">Contact details</h2>
            <p className="meta" style={{ marginBottom: 20 }}>
              {confirmed ? `Visible according to ${firstName}’s settings.` : "This profile hasn’t been claimed yet, so only public details are shown."}
            </p>
            <div className="detail-list">
              {CONTACT_KINDS.map(({ kind, label }) => {
                const points = person.contact_points.filter((p) => p.kind === kind);
                return (
                  <div key={kind} className="detail-row">
                    <span className="eyebrow">{label}</span>
                    {points.length ? (
                      points.map((p) => (
                        <div key={p.id} className="od-stack" style={{ ["--od-gap" as string]: "4px" }}>
                          {kind === "email" ? (
                            <a className="small" href={`mailto:${p.value}`}>
                              {p.value}
                            </a>
                          ) : kind === "linkedin" || kind === "website" ? (
                            <a className="small od-truncate" href={p.value} target="_blank" rel="noreferrer noopener">
                              {p.value.replace(/^https?:\/\/(www\.)?/, "")}
                            </a>
                          ) : (
                            <span className="small">{p.value}</span>
                          )}
                          <span className="meta">{visibilityNote(p)}</span>
                          {p.verified_at && kind === "email" && (
                            <span className="chip success" style={{ justifySelf: "start" }}>
                              <Icon name="check" />
                              Email verified
                            </span>
                          )}
                        </div>
                      ))
                    ) : (
                      <>
                        <span className="small">
                          <Icon name="lock" /> Not shared with you
                        </span>
                        <span className="meta">
                          {confirmed ? `${firstName} hasn’t made this detail available.` : "No member-approved visibility yet."}
                        </span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="form-actions">
              <DialogButton label="Where did this data come from?" title="About this profile’s data">
                <p className="small muted">Each field records its source. Member-provided details always replace other sources.</p>
                <div className="detail-list" style={{ marginTop: 16 }}>
                  {person.field_provenance.length ? (
                    person.field_provenance.map((p) => (
                      <div key={`${p.field}-${p.source}`} className="detail-row">
                        <strong className="small">{FIELD_LABELS[p.field] ?? p.field}</strong>
                        <span className="small">
                          {SOURCE_LABELS[p.source] ?? p.source} · {new Date(p.fetched_at).toLocaleDateString()}
                        </span>
                        {p.source_url && (
                          <a className="small od-truncate" href={p.source_url} target="_blank" rel="noreferrer noopener">
                            {p.source_url}
                          </a>
                        )}
                      </div>
                    ))
                  ) : (
                    <>
                      <div className="detail-row">
                        <strong className="small">Name, role & education</strong>
                        <span className="small">{confirmed ? "Confirmed by the member" : "Institution listings, public and licensed sources"}</span>
                      </div>
                      <div className="detail-row">
                        <strong className="small">Summary</strong>
                        <span className="small">AI-generated from profile fields; not independently verified</span>
                      </div>
                    </>
                  )}
                </div>
              </DialogButton>
            </div>
          </section>
          <p className="footnote">
            {confirmed
              ? "Confirmed: claimed and verified by this person."
              : "Unconfirmed is a normal profile state. The person has not yet claimed it."}
          </p>
        </aside>
      </div>
    </>
  );
}

function ProfileSkeleton() {
  return (
    <div className="panel pad" role="status" aria-label="Loading profile">
      <div className="skeleton big" />
      <div className="skeleton" />
      <div className="skeleton short" />
    </div>
  );
}

export default function PersonPage({ params, searchParams }: PageProps<"/people/[id]">) {
  return (
    <Suspense fallback={<ProfileSkeleton />}>
      <Profile params={params} searchParams={searchParams} />
    </Suspense>
  );
}
