import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminTabs } from "@/components/admin-tabs";
import { PageTitle } from "@/components/person";
import { requireAdmin } from "@/lib/viewer";
import { RosterForm } from "./roster-form";

// Where no background queue is reachable, lookups for imported people run after the response.
export const maxDuration = 300;

export const metadata: Metadata = { title: "Roster import" };

async function Roster() {
  await requireAdmin("/admin/roster");
  return <RosterForm />;
}

export default function RosterPage() {
  return (
    <>
      <PageTitle
        eyebrow="Administration / Roster import"
        title="Check a roster before it touches the directory."
        description="See where each row came from, who may already be here, who asked to be removed, and what’s missing. Previewing changes nothing; you choose to import after."
      />
      <AdminTabs />
      <Suspense fallback={<div className="panel pad"><div className="skeleton big" /><div className="skeleton" /></div>}>
        <Roster />
      </Suspense>
    </>
  );
}
