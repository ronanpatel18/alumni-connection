import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Avatar, isConfirmed, PageTitle } from "@/components/person";
import { TripSteps } from "@/components/trip-steps";
import { getAi } from "@/lib/ai";
import { createClient } from "@/lib/supabase/server";
import { loadTrip, tripCity, tripDates, tripTimeZone } from "@/lib/trips";
import { requireMember } from "@/lib/viewer";
import { OutreachForm } from "./outreach-form";

export const metadata: Metadata = { title: "Start a conversation" };

interface Recipient {
  id: string;
  full_name: string;
  current_title: string | null;
  status: string;
  photo_url: string | null;
  organizations: { name: string } | null;
  educations: { grad_year: number | null }[];
  contact_points: { kind: string; value: string }[];
  group_memberships: { groups: { name: string } | null }[];
}

async function Outreach({ params }: { params: PageProps<"/trips/[id]/outreach/[personId]">["params"] }) {
  const { id, personId } = await params;
  const viewer = await requireMember(`/trips/${id}/outreach/${personId}`);
  if (!/^[0-9a-f-]{36}$/i.test(personId)) notFound();
  const supabase = await createClient();
  const trip = await loadTrip(supabase, id);
  if (!trip) notFound();

  // Contact details come back only where this person's visibility settings allow (RLS).
  const [{ data: person }, { data: existing }, { data: reason }, { data: sender }] = await Promise.all([
    supabase
      .from("people")
      .select(
        "id, full_name, current_title, status, photo_url, organizations:current_organization_id(name), educations(grad_year), contact_points(kind, value), group_memberships(groups(name))",
      )
      .eq("id", personId)
      .maybeSingle<Recipient>(),
    supabase
      .from("outreach_drafts")
      .select("subject, body, ai_drafted")
      .eq("person_id", personId)
      .eq("trip_id", trip.id)
      .maybeSingle<{ subject: string; body: string; ai_drafted: boolean }>(),
    supabase
      .from("recommendations")
      .select("reasons")
      .eq("person_id", personId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ reasons: string[] }>(),
    viewer.personId
      ? supabase
          .from("people")
          .select("full_name, headline")
          .eq("id", viewer.personId)
          .maybeSingle<{ full_name: string; headline: string | null }>()
      : Promise.resolve({ data: null }),
  ]);
  if (!person) notFound();

  const headline = [person.current_title, person.organizations?.name].filter(Boolean).join(" at ") || null;
  const groups = person.group_memberships.map((m) => m.groups?.name).filter((g): g is string => Boolean(g));
  const why = reason?.reasons?.[0] ?? null;

  // First visit: the AI writes a draft once, saved privately so it isn't regenerated.
  let draft = existing;
  if (!draft) {
    try {
      const written = await getAi().draftOutreach({
        senderName: sender?.full_name ?? "[Your name]",
        senderHeadline: sender?.headline ?? null,
        recipientName: person.full_name,
        recipientHeadline: headline,
        reason: trip.goal ?? "to meet fellow alumni while I'm in town",
        sharedContext: [],
        recipientGroups: groups.slice(0, 3),
        trip: { city: tripCity(trip), dates: tripDates(trip) },
      });
      draft = { ...written, ai_drafted: true };
      await supabase.from("outreach_drafts").insert({ owner_user_id: viewer.userId, person_id: person.id, trip_id: trip.id, ...draft });
    } catch {
      draft = {
        subject: `Fellow UW–Madison alum visiting ${trip.places?.name ?? "town"}`,
        body: `Hi ${person.full_name.split(" ")[0]},\n\n`,
        ai_drafted: false,
      };
    }
  }

  const gradYear = person.educations.map((e) => e.grad_year).find(Boolean);
  return (
    <>
      <PageTitle
        eyebrow="Trips / Start a conversation"
        title="A thoughtful first hello."
        description={`To ${person.full_name}${headline ? ` · ${headline}` : ""}`}
      />
      <TripSteps current={2} />
      <div className="split">
        <OutreachForm
          canMessage={isConfirmed(person.status) && person.id !== viewer.personId}
          tripId={trip.id}
          personId={person.id}
          recipientName={person.full_name}
          subject={draft.subject}
          body={draft.body}
          aiDrafted={draft.ai_drafted}
          email={person.contact_points.find((c) => c.kind === "email")?.value ?? null}
          linkedin={person.contact_points.find((c) => c.kind === "linkedin")?.value ?? null}
          tripStart={trip.starts_on}
          timeZone={tripTimeZone(trip)}
        />
        <aside className="right-rail stack">
          <section className="panel pad">
            <div className="od-row" style={{ alignItems: "center" }}>
              <Avatar name={person.full_name} photoUrl={person.photo_url} confirmed={isConfirmed(person.status)} />
              <div className="od-field">
                <h3>{person.full_name}</h3>
                <span className="meta">{gradYear ? `UW–Madison, Class of ${gradYear}` : "UW–Madison"}</span>
              </div>
            </div>
            {why && (
              <>
                <div className="divider" />
                <span className="chip ai">Why this person</span>
                <p className="small muted" style={{ marginTop: 12 }}>
                  {why}
                </p>
              </>
            )}
            <div className="form-actions">
              <Link className="btn quiet" style={{ paddingInline: 0 }} href={`/people/${person.id}`}>
                View profile
              </Link>
              <Link className="btn quiet" style={{ paddingInline: 0 }} href={`/trips/${trip.id}`}>
                Back to shortlist
              </Link>
            </div>
          </section>
          <section className="panel pad">
            <h3>Keep it easy to answer</h3>
            <p className="small muted" style={{ marginTop: 12 }}>
              Say why you’re reaching out, ask for something specific, and leave room for a gracious no.
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}

export default function OutreachPage({ params }: PageProps<"/trips/[id]/outreach/[personId]">) {
  return (
    <Suspense
      fallback={
        <div className="panel pad" role="status" aria-label="Drafting your message">
          <div className="skeleton big" />
          <div className="skeleton" />
          <div className="skeleton short" />
          <p className="small muted">Drafting your message…</p>
        </div>
      }
    >
      <Outreach params={params} />
    </Suspense>
  );
}
