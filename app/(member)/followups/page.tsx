import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { Icon } from "@/components/icon";
import { ResultNotice } from "@/components/notice";
import { EmptyState, PageTitle } from "@/components/person";
import { RelationshipTabs } from "@/components/relationship-tabs";
import { formatDay } from "@/lib/calendar";
import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/viewer";
import { deleteInteraction, logInteraction, setFollowUpDone } from "./actions";

export const metadata: Metadata = { title: "Follow-ups" };

const KINDS: Record<string, string> = { meeting: "Met in person", call: "Call", email: "Email or message", intro: "Introduction", event: "Saw them at an event", other: "Other" };
const RESULTS = {
  reminder: { text: "Saved. You’ll get a reminder on the day you chose." },
  logged: { text: "Saved to your private log." },
  deleted: { text: "Deleted." },
};

interface Row {
  id: string;
  kind: string;
  occurred_at: string | null;
  follow_up_at: string | null;
  follow_up_done_at: string | null;
  summary: string | null;
  created_at: string;
  people: { id: string; full_name: string; current_title: string | null; organizations: { name: string } | null } | null;
}

/** The member's log, split by what needs doing. Reads the clock, so it lives outside the component. */
async function loadFollowUps(userId: string, personParam: string | null) {
  const supabase = await createClient();
  const [{ data, error }, { data: saved }, { data: chosen }] = await Promise.all([
    supabase
      .from("interactions")
      .select("id, kind, occurred_at, follow_up_at, follow_up_done_at, summary, created_at, people(id, full_name, current_title, organizations:current_organization_id(name))")
      .eq("owner_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(300)
      .returns<Row[]>(),
    supabase.from("saved_contacts").select("people(id, full_name)").eq("owner_user_id", userId).returns<{ people: { id: string; full_name: string } | null }[]>(),
    personParam ? supabase.from("people").select("id, full_name").eq("id", personParam).maybeSingle<{ id: string; full_name: string }>() : Promise.resolve({ data: null }),
  ]);
  const rows = (data ?? []).filter((r) => r.people);
  const now = new Date().toISOString();
  const open = rows.filter((r) => r.follow_up_at && !r.follow_up_done_at).sort((a, b) => a.follow_up_at!.localeCompare(b.follow_up_at!));
  const choices = new Map<string, string>();
  if (chosen) choices.set(chosen.id, chosen.full_name);
  for (const s of saved ?? []) if (s.people) choices.set(s.people.id, s.people.full_name);
  // Anyone already in the log can be logged again without saving them first.
  for (const r of rows) choices.set(r.people!.id, r.people!.full_name);
  return {
    error,
    due: open.filter((r) => r.follow_up_at! <= now),
    upcoming: open.filter((r) => r.follow_up_at! > now),
    log: rows.filter((r) => !r.follow_up_at || r.follow_up_done_at).slice(0, 40),
    choices: [...choices].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    chosen: chosen?.id ?? null,
    // The default date for the form. Wisconsin's day, since the server's clock is in UTC.
    today: new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" }),
  };
}

function Item({ row, state }: { row: Row; state: "due" | "upcoming" | "log" }) {
  const person = row.people!;
  const role = [person.current_title, person.organizations?.name].filter(Boolean).join(" at ");
  return (
    <div className="detail-row" style={{ padding: "20px 24px" }}>
      <div className="od-cluster" style={{ justifyContent: "space-between" }}>
        <div>
          <Link href={`/people/${person.id}`}>
            <strong>{person.full_name}</strong>
          </Link>
          {role && <span className="meta"> · {role}</span>}
        </div>
        {row.follow_up_at && !row.follow_up_done_at && (
          <span className={state === "due" ? "chip ai" : "chip subtle"}>
            <Icon name="clock" /> {state === "due" ? "Due" : "Follow up"} {formatDay(row.follow_up_at)}
          </span>
        )}
        {row.follow_up_done_at && (
          <span className="chip success">
            <Icon name="check" /> Followed up
          </span>
        )}
      </div>
      <p className="meta">
        {KINDS[row.kind] ?? "Other"}
        {row.occurred_at ? ` · ${formatDay(row.occurred_at)}` : ""}
      </p>
      {row.summary && <p className="small" style={{ whiteSpace: "pre-wrap" }}>{row.summary}</p>}
      <div className="od-cluster">
        {row.follow_up_at && (
          <form action={setFollowUpDone}>
            <input type="hidden" name="id" value={row.id} />
            <input type="hidden" name="done" value={row.follow_up_done_at ? "false" : "true"} />
            <button type="submit" className={row.follow_up_done_at ? "btn quiet" : "btn"}>
              {row.follow_up_done_at ? "Reopen" : "Mark done"}
            </button>
          </form>
        )}
        <Link className="btn quiet" href={`/followups?person=${person.id}#log`}>
          Log another
        </Link>
        <form action={deleteInteraction}>
          <input type="hidden" name="id" value={row.id} />
          <button type="submit" className="btn quiet">
            Delete
          </button>
        </form>
      </div>
    </div>
  );
}

function Section({ title, count, rows, state, empty }: { title: string; count?: boolean; rows: Row[]; state: "due" | "upcoming" | "log"; empty?: string }) {
  if (!rows.length && !empty) return null;
  return (
    <section className="panel">
      <div className="table-title" style={{ paddingBottom: rows.length ? 0 : 24 }}>
        <div className="section-head" style={{ margin: 0 }}>
          <h2>{title}</h2>
          {count && <span className="badge-count">{rows.length}</span>}
        </div>
        {!rows.length && <p className="meta" style={{ marginTop: 8 }}>{empty}</p>}
      </div>
      {rows.length > 0 && <div className="detail-list">{rows.map((row) => <Item key={row.id} row={row} state={state} />)}</div>}
    </section>
  );
}

async function FollowUps({ searchParams }: { searchParams: PageProps<"/followups">["searchParams"] }) {
  const viewer = await requireMember("/followups");
  const { person, result } = await searchParams;
  const personParam = typeof person === "string" && /^[0-9a-f-]{36}$/i.test(person) ? person : null;
  const { error, due, upcoming, log, choices, chosen, today } = await loadFollowUps(viewer.userId, personParam);
  if (error) throw error;

  return (
    <div className="split">
      <div className="stack">
        <ResultNotice result={result} messages={RESULTS} />
        <Section title="Due now" count rows={due} state="due" empty="Nothing is due. Reminders you set appear here on their day." />
        <Section title="Coming up" count rows={upcoming} state="upcoming" />
        <Section title="Your log" rows={log} state="log" />
      </div>
      <aside className="right-rail stack" id="log">
        {choices.length ? (
          <ActionForm action={logInteraction} submitLabel="Save" pendingLabel="Saving…">
            <h2 className="rail-title">Log a conversation</h2>
            <div className="stack" style={{ gap: 16 }}>
              <div className="field">
                <label htmlFor="person_id">Who</label>
                <select id="person_id" name="person_id" defaultValue={chosen ?? ""} required>
                  <option value="" disabled>
                    Choose someone
                  </option>
                  {choices.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <small>People you’ve saved or logged before. Open anyone’s profile to log a conversation with them.</small>
              </div>
              <div className="field">
                <label htmlFor="kind">How you were in touch</label>
                <select id="kind" name="kind" defaultValue="meeting">
                  {Object.entries(KINDS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="occurred_on">When</label>
                <input id="occurred_on" name="occurred_on" type="date" defaultValue={today} />
              </div>
              <div className="field">
                <label htmlFor="summary">What you talked about</label>
                <textarea id="summary" name="summary" rows={4} maxLength={5000} placeholder="Only you can see this." />
              </div>
              <div className="field">
                <label htmlFor="follow_up_on">Remind me to follow up on (optional)</label>
                <input id="follow_up_on" name="follow_up_on" type="date" />
                <small>You’ll get an email that day. They aren’t told.</small>
              </div>
            </div>
          </ActionForm>
        ) : (
          <section className="panel">
            <EmptyState
              title="Start with someone you know"
              text="Save a person, or open their profile and choose Log a conversation. Then note what you talked about and when to follow up."
              action={
                <Link className="btn primary" href="/search">
                  Find alumni
                </Link>
              }
            />
          </section>
        )}
      </aside>
    </div>
  );
}

export default function FollowUpsPage({ searchParams }: PageProps<"/followups">) {
  return (
    <>
      <PageTitle
        eyebrow="Relationships / Follow-ups"
        title="Keep the conversations going."
        description="A private log of who you talked to and when to get back in touch. Nobody else sees it, and nobody is notified."
      />
      <RelationshipTabs />
      <Suspense fallback={<div className="panel pad"><div className="skeleton big" /><div className="skeleton" /><div className="skeleton short" /></div>}>
        <FollowUps searchParams={searchParams} />
      </Suspense>
    </>
  );
}
