import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { EmptyState, isConfirmed, PageTitle } from "@/components/person";
import { RelationshipTabs } from "@/components/relationship-tabs";
import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/viewer";
import { proposeMeeting } from "../actions";

export const metadata: Metadata = { title: "Propose a meeting" };

async function Propose({ searchParams }: { searchParams: PageProps<"/meetings/new">["searchParams"] }) {
  const viewer = await requireMember("/meetings");
  const { person, trip } = await searchParams;
  if (typeof person !== "string" || !/^[0-9a-f-]{36}$/i.test(person)) notFound();
  const tripId = typeof trip === "string" && /^[0-9a-f-]{36}$/i.test(trip) ? trip : "";
  const supabase = await createClient();
  const { data: target } = await supabase.from("people").select("id, full_name, status, city, state").eq("id", person).maybeSingle<{ id: string; full_name: string; status: string; city: string | null; state: string | null }>();
  if (!target) notFound();
  const first = target.full_name.split(" ")[0];

  if (!isConfirmed(target.status) || target.id === viewer.personId) {
    return (
      <section className="panel">
        <EmptyState
          title={target.id === viewer.personId ? "That’s your own profile" : `${first} hasn’t joined yet`}
          text="Meetings are arranged between members, so both people can accept and see the time. For someone who hasn’t joined, use the contact details on their profile."
          action={
            <Link className="btn" href={`/people/${target.id}`}>
              Back to profile
            </Link>
          }
        />
      </section>
    );
  }
  return (
    <div className="narrow">
      <ActionForm
        action={proposeMeeting}
        submitLabel="Send invitation"
        pendingLabel="Sending…"
        secondary={
          <Link className="btn" href={`/people/${target.id}`}>
            Cancel
          </Link>
        }
      >
        <h2>Meet {target.full_name}</h2>
        <p className="small muted" style={{ margin: "12px 0 24px" }}>
          {first} gets an email from Alumni Connect and accepts or declines here. Your email address isn’t shared.
        </p>
        <input type="hidden" name="person_id" value={target.id} />
        <input type="hidden" name="trip_id" value={tripId} />
        <div className="form-grid">
          <div className="field full">
            <label htmlFor="title">What it’s for</label>
            <input id="title" name="title" maxLength={200} required defaultValue={`Coffee with ${first}`} />
          </div>
          <div className="field">
            <label htmlFor="starts_at">Date and time</label>
            <input id="starts_at" name="starts_at" type="datetime-local" required />
            <small>In your own time zone. {first} sees it in theirs.</small>
          </div>
          <div className="field">
            <label htmlFor="duration">Length</label>
            <select id="duration" name="duration" defaultValue="30">
              <option value="15">15 minutes</option>
              <option value="30">30 minutes</option>
              <option value="45">45 minutes</option>
              <option value="60">1 hour</option>
              <option value="90">1½ hours</option>
            </select>
          </div>
          <div className="field full">
            <label htmlFor="location">Where (optional)</label>
            <input id="location" name="location" maxLength={300} placeholder={target.city ? `A café in ${target.city}, or a video call link` : "A place, or a video call link"} />
          </div>
          <div className="field full">
            <label htmlFor="note">A note (optional)</label>
            <textarea id="note" name="note" rows={3} maxLength={2000} placeholder="Other times that work for you, or what you’d like to talk about." />
          </div>
        </div>
      </ActionForm>
    </div>
  );
}

export default function NewMeetingPage({ searchParams }: PageProps<"/meetings/new">) {
  return (
    <>
      <PageTitle eyebrow="Relationships / Meetings" title="Propose a time." description="An invitation, not a booking: it’s on both calendars only once they accept." />
      <RelationshipTabs />
      <Suspense fallback={<div className="panel pad"><div className="skeleton big" /><div className="skeleton" /></div>}>
        <Propose searchParams={searchParams} />
      </Suspense>
    </>
  );
}
