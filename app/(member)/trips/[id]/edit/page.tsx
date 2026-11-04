import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DialogButton } from "@/components/dialog-button";
import { PageTitle } from "@/components/person";
import { TripSteps } from "@/components/trip-steps";
import { createClient } from "@/lib/supabase/server";
import { loadTrip } from "@/lib/trips";
import { requireMember } from "@/lib/viewer";
import { deleteTrip } from "../../actions";
import { TripFormPanel } from "../../trip-form-panel";

export const metadata: Metadata = { title: "Edit trip" };

async function EditTrip({ params }: { params: PageProps<"/trips/[id]/edit">["params"] }) {
  const { id } = await params;
  await requireMember(`/trips/${id}/edit`);
  const trip = await loadTrip(await createClient(), id);
  if (!trip) notFound();
  return (
    <>
      <TripFormPanel
        defaults={{
          trip_id: trip.id,
          place_id: String(trip.place_id),
          starts_on: trip.starts_on,
          ends_on: trip.ends_on,
          industry_slugs: trip.industry_slugs,
          goal: trip.goal ?? "",
        }}
      />
      <div style={{ marginTop: 32 }}>
        <DialogButton label="Delete this trip" title="Delete this trip?" className="btn danger">
          <p className="small muted">This deletes the trip, its shortlist and its saved drafts. Nobody is notified. It can’t be undone.</p>
          <form action={deleteTrip} className="form-actions">
            <input type="hidden" name="trip_id" value={trip.id} />
            <button type="submit" className="btn danger">
              Delete trip
            </button>
          </form>
        </DialogButton>
      </div>
    </>
  );
}

export default function EditTripPage({ params }: PageProps<"/trips/[id]/edit">) {
  return (
    <>
      <PageTitle eyebrow="Trips / Edit trip" title="Adjust your plans." description="Change the dates, city, industries or goal. Your shortlist stays." />
      <TripSteps current={0} />
      <Suspense fallback={<div className="panel pad"><div className="skeleton big" /><div className="skeleton" /></div>}>
        <EditTrip params={params} />
      </Suspense>
    </>
  );
}
