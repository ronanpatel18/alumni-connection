import type { Metadata } from "next";
import { Suspense } from "react";
import { Icon } from "@/components/icon";
import { PublicHeader } from "@/components/public-header";
import { linkIdentity } from "@/lib/profile-links";
import { REMOVED_NOTICE, RemoveForm } from "./remove-form";

export const metadata: Metadata = { title: "Remove your profile", robots: { index: false, follow: false } };

async function RemovePanel({ params }: { params: PageProps<"/remove/[token]">["params"] }) {
  const { token } = await params;
  const identity = await linkIdentity(token);

  if (identity.state !== "valid" && identity.state !== "claimed") {
    return identity.state === "removed" ? (
      <div className="notice success" role="status">
        <Icon name="check" />
        <div>{REMOVED_NOTICE}</div>
      </div>
    ) : (
      <div className="notice error" role="alert">
        <Icon name="info" />
        <div>
          {identity.state === "expired"
            ? "This link has expired. Contact the Alumni Connect team and we’ll remove your profile."
            : "This link isn’t valid. Check that you copied the whole link from your invitation email."}
        </div>
      </div>
    );
  }
  const subtitle = identity.class_year ? `Class of ${identity.class_year}` : (identity.groups[0] ?? null);
  return <RemoveForm token={token} name={identity.name} subtitle={subtitle} />;
}

export default function RemovePage({ params }: PageProps<"/remove/[token]">) {
  return (
    <>
      <PublicHeader action={{ href: "/login", label: "Sign in" }} />
      <main className="public-main">
        <div className="eyebrow accent" style={{ marginBottom: 16 }}>
          No account required
        </div>
        <h1>Remove your profile.</h1>
        <p>You control whether you’re part of this network.</p>
        <section className="panel pad" id="removal-content">
          <Suspense fallback={<div className="skeleton big" role="status" aria-label="Loading" />}>
            <RemovePanel params={params} />
          </Suspense>
        </section>
      </main>
    </>
  );
}
