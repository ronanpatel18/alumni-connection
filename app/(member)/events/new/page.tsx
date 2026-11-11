import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { CommunityTabs } from "@/components/community-tabs";
import { PageTitle } from "@/components/person";
import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/viewer";
import { createEvent } from "../actions";

export const metadata: Metadata = { title: "Post an event" };

async function NewEvent() {
  await requireMember("/events");
  const supabase = await createClient();
  const { data: places } = await supabase.from("places").select("id, name, state").order("name").returns<{ id: number; name: string; state: string }[]>();
  return (
    <div className="narrow">
      <ActionForm
        action={createEvent}
        submitLabel="Post event"
        pendingLabel="Posting…"
        secondary={
          <Link className="btn" href="/events">
            Cancel
          </Link>
        }
      >
        <h2>Post an event</h2>
        <p className="small muted" style={{ margin: "12px 0 24px" }}>
          Every verified member can see it and who’s going. Your name shows as the host.
        </p>
        <div className="form-grid">
          <div className="field full">
            <label htmlFor="title">Name</label>
            <input id="title" name="title" maxLength={200} required placeholder="Badgers game watch at Will’s Northwoods Inn" />
          </div>
          <div className="field">
            <label htmlFor="starts_at">Starts</label>
            <input id="starts_at" name="starts_at" type="datetime-local" required />
            <small>In your own time zone.</small>
          </div>
          <div className="field">
            <label htmlFor="ends_at">Ends (optional)</label>
            <input id="ends_at" name="ends_at" type="datetime-local" />
          </div>
          <div className="field">
            <label htmlFor="place_id">City</label>
            <select id="place_id" name="place_id" defaultValue="">
              <option value="">Not listed, or online</option>
              {(places ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}, {p.state}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="city">Another city (if not listed)</label>
            <div className="od-cluster">
              <input id="city" name="city" maxLength={100} placeholder="City" style={{ flex: 2, minWidth: 120 }} />
              <input name="state" maxLength={2} placeholder="WI" aria-label="State" style={{ flex: 1, minWidth: 60 }} />
            </div>
          </div>
          <div className="field full">
            <label htmlFor="venue">Venue or address (optional)</label>
            <input id="venue" name="venue" maxLength={300} />
          </div>
          <div className="field full">
            <label htmlFor="description">Details (optional)</label>
            <textarea id="description" name="description" rows={4} maxLength={4000} placeholder="Who it’s for, what to expect, whether guests are welcome." />
          </div>
          <div className="field full">
            <label htmlFor="url">Link for tickets or a video call (optional)</label>
            <input id="url" name="url" type="url" maxLength={500} placeholder="https://" />
          </div>
        </div>
        <label className="checkbox" style={{ marginTop: 16 }}>
          <input type="checkbox" name="is_online" />
          This event is online
        </label>
      </ActionForm>
    </div>
  );
}

export default function NewEventPage() {
  return (
    <>
      <PageTitle eyebrow="Community / Events" title="Bring Badgers together." description="Post a get-together for members in your city, or online." />
      <CommunityTabs />
      <Suspense fallback={<div className="panel pad"><div className="skeleton big" /><div className="skeleton" /></div>}>
        <NewEvent />
      </Suspense>
    </>
  );
}
