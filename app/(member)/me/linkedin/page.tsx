import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DialogButton } from "@/components/dialog-button";
import { PageTitle } from "@/components/person";
import { ProfileTabs } from "@/components/profile-tabs";
import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/viewer";
import { removeImportedConnections } from "./actions";
import { ImportForm } from "./import-form";

export const metadata: Metadata = { title: "LinkedIn import" };

async function LinkedInImport() {
  const viewer = await requireMember("/me/linkedin");
  const supabase = await createClient();
  const { data } = await supabase
    .from("my_connections")
    .select("person_id, created_at, people(full_name)")
    .eq("owner_user_id", viewer.userId)
    .returns<{ person_id: string; created_at: string; people: { full_name: string } | null }[]>();
  const known = (data ?? []).filter((r) => r.people).sort((a, b) => a.people!.full_name.localeCompare(b.people!.full_name));

  return (
    <div className="split">
      <div className="stack">
        <ImportForm hasProfile={Boolean(viewer.personId)} />
        <section className="panel pad">
          <div className="section-head">
            <h2>People you already know</h2>
            <span className="chip">Only you</span>
          </div>
          {known.length ? (
            <>
              <p className="meta" style={{ marginBottom: 16 }}>
                From your LinkedIn connections, imported {new Date(known[0].created_at).toLocaleDateString()}.
              </p>
              <div className="od-cluster">
                {known.map((k) => (
                  <Link key={k.person_id} className="chip" href={`/people/${k.person_id}`}>
                    {k.people!.full_name}
                  </Link>
                ))}
              </div>
              <div className="form-actions">
                <DialogButton label="Remove imported connections" title="Remove imported connections?" className="btn quiet">
                  <p className="small muted">This deletes the list of people you know from LinkedIn. Your profile isn’t changed.</p>
                  <form action={removeImportedConnections} className="form-actions">
                    <button type="submit" className="btn danger">
                      Remove them
                    </button>
                  </form>
                </DialogButton>
              </div>
            </>
          ) : (
            <p className="small muted">Import your connections to see which of them are in the directory. Nobody is notified.</p>
          )}
        </section>
      </div>
      <aside className="right-rail stack">
        <section className="panel pad">
          <h2 className="rail-title">Get your export</h2>
          <ol className="steps-list small">
            <li>On LinkedIn, open Settings &amp; Privacy → Data privacy → Get a copy of your data.</li>
            <li>Choose the data you want: Connections, Positions and Education are enough.</li>
            <li>LinkedIn emails a link, usually within minutes. Download the ZIP and choose it here.</li>
          </ol>
        </section>
        <section className="panel pad">
          <h3>Your data stays yours</h3>
          <p className="small muted" style={{ marginTop: 12 }}>
            The file is read in your browser and never stored. Messages, emails and everything else in the export are ignored. Imported
            connections are visible only to you, and you can remove them anytime.
          </p>
        </section>
      </aside>
    </div>
  );
}

export default function LinkedInImportPage() {
  return (
    <>
      <PageTitle
        eyebrow="Profile & privacy / LinkedIn import"
        title="Bring your LinkedIn with you."
        description="Add your work history from your own LinkedIn export, and see which of your connections are already in the network."
      />
      <ProfileTabs />
      <Suspense fallback={<div className="panel pad"><div className="skeleton big" /><div className="skeleton" /></div>}>
        <LinkedInImport />
      </Suspense>
    </>
  );
}
