import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Brand } from "@/components/brand";
import { Icon } from "@/components/icon";
import { getViewer } from "@/lib/viewer";

export const metadata: Metadata = { title: "Verification pending" };

async function PendingStatus() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (viewer.isVerified) redirect("/discover");

  return (
    <section className="panel pad">
      <div className="od-cluster" style={{ marginBottom: 24 }}>
        <span className="chip">
          <Icon name="clock" />
          Verification pending
        </span>
        <span className="small muted">{viewer.email}</span>
      </div>
      <div className="notice" role="status">
        <Icon name="info" />
        <div>
          <p>We couldn’t automatically match your email to an alumni record yet.</p>
          <p>If we already have a profile for you, you’ll be able to claim it. Otherwise an administrator reviews your request.</p>
        </div>
      </div>
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
