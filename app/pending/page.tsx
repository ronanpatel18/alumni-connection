import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Brand } from "@/components/brand";
import { Icon } from "@/components/icon";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/viewer";

export const metadata: Metadata = { title: "Verification pending" };

async function PendingStatus() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  // Someone still here when an administrator approves them goes on to setup.
  if (viewer.isVerified) redirect(viewer.personId ? "/welcome" : "/discover");
  const supabase = await createClient();
  const { count: pendingClaims } = await supabase
    .from("claim_requests")
    .select("id", { count: "exact", head: true })
    .eq("user_id", viewer.userId)
    .eq("status", "pending");

  return (
    <section className="panel pad">
      <div className="od-cluster" style={{ marginBottom: 24 }}>
        <span className="chip">
          <Icon name="clock" />
          Verification pending
        </span>
        <span className="small muted">{viewer.email}</span>
      </div>
      {pendingClaims ? (
        <div className="notice success" role="status">
          <Icon name="check" />
          <div>
            <p>
              <strong>We received your request to claim your profile.</strong>
            </p>
            <p>Your email isn’t on file for that profile, so an administrator will confirm it’s you before giving access.</p>
          </div>
        </div>
      ) : (
        <div className="notice" role="status">
          <Icon name="info" />
          <div>
            <p>We couldn’t automatically match your email to an alumni record yet.</p>
            <p>If you received an invitation link, open it to claim your profile. Otherwise an administrator reviews your request.</p>
          </div>
        </div>
      )}
      {process.env.NODE_ENV === "development" && (
        <div className="notice" style={{ marginTop: 16 }}>
          <Icon name="settings" />
          <div>
            <p>
              <strong>Local development:</strong> verify yourself with
            </p>
            <code className="mono small">npm run dev:promote -- {viewer.email} admin</code>
          </div>
        </div>
      )}
      <p className="meta" style={{ marginTop: 16 }}>
        No profile access while verification is pending. That protects everyone’s contact details.
      </p>
    </section>
  );
}

export default function PendingPage() {
  return (
    <>
      <header className="public-header">
        <Brand href="/" />
        <form action="/auth/signout" method="post">
          <button type="submit" className="btn quiet">
            Sign out
          </button>
        </form>
      </header>
      <main className="public-main">
        <div className="eyebrow accent" style={{ marginBottom: 16 }}>
          One more step
        </div>
        <h1>
          You’re signed in.
          <br />
          Let’s verify your Wisconsin connection.
        </h1>
        <p>Profiles and contact details become available after your alumni status is verified.</p>
        <Suspense
          fallback={
            <section className="panel pad" role="status" aria-label="Loading">
              <div className="skeleton" />
            </section>
          }
        >
          <PendingStatus />
        </Suspense>
        <p className="small muted" style={{ marginTop: 24 }}>
          Need help? Contact the Alumni Connect team.
        </p>
      </main>
    </>
  );
}
