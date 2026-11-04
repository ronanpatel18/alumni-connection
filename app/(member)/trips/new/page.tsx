import type { Metadata } from "next";
import { Suspense } from "react";
import { PageTitle } from "@/components/person";
import { TripSteps } from "@/components/trip-steps";
import { requireMember } from "@/lib/viewer";
import { TripFormPanel } from "../trip-form-panel";

export const metadata: Metadata = { title: "Plan a trip" };

async function NewTrip() {
  await requireMember("/trips/new");
  return <TripFormPanel defaults={{ trip_id: "", place_id: "", starts_on: "", ends_on: "", industry_slugs: [], goal: "" }} />;
}

export default function NewTripPage() {
  return (
    <>
      <PageTitle
        eyebrow="Trips / Plan a visit"
        title="Make room for a good conversation."
        description="Tell us where you’re going and what would make a meeting worthwhile."
      />
      <TripSteps current={0} />
      <Suspense fallback={<div className="panel pad"><div className="skeleton big" /><div className="skeleton" /></div>}>
        <NewTrip />
      </Suspense>
    </>
  );
}
