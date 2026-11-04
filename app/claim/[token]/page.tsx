import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { initialsFor } from "@/components/account-block";
import { Icon } from "@/components/icon";
import { PublicHeader } from "@/components/public-header";
import { CLAIM_ERROR_MESSAGES, linkIdentity } from "@/lib/profile-links";
import { getViewer } from "@/lib/viewer";
import { ClaimEmailForm } from "./claim-email-form";

export const metadata: Metadata = { title: "Is this you?", robots: { index: false, follow: false } };

function Problem({ message }: { message: string }) {
  return (
    <section className="panel pad">
      <div className="notice error" role="alert">
        <Icon name="info" />
        <div>{message}</div>
      </div>
      <p className="small muted" style={{ marginTop: 16 }}>
        Need a new link? Contact the Alumni Connect team.
      </p>
    </section>
  );
}

async function ClaimPanel({ params, searchParams }: { params: PageProps<"/claim/[token]">["params"]; searchParams: PageProps<"/claim/[token]">["searchParams"] }) {
  const { token } = await params;
  const { error, status } = await searchParams;
  const [identity, viewer] = await Promise.all([linkIdentity(token), getViewer()]);

  if (identity.state === "invalid" || identity.state === "expired" || identity.state === "removed") {
    return <Problem message={CLAIM_ERROR_MESSAGES[identity.state === "invalid" ? "invalid_link" : identity.state]} />;
  }
  if (identity.state === "claimed") {
    return (
      <section className="panel pad">
        <div className="notice" role="status">
          <Icon name="check" />
          <div>
            <p>This profile has already been claimed.</p>
            <p>If that was you, sign in to manage it. If not, contact the Alumni Connect team.</p>
          </div>
        </div>
        <div className="form-actions">
          <Link className="btn primary" href="/login">
            Sign in
          </Link>
        </div>
      </section>
    );
  }

  const subtitle = [
    "University of Wisconsin–Madison",
    identity.class_year ? `Class of ${identity.class_year}` : identity.groups[0] ?? null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <section className="panel pad">
        {typeof error === "string" && CLAIM_ERROR_MESSAGES[error] && (
          <div className="notice error" role="alert" style={{ marginBottom: 24 }}>
            <Icon name="info" />
            <div>{CLAIM_ERROR_MESSAGES[error]}</div>
          </div>
        )}
        <div className="od-row">
          <span className="avatar" aria-hidden="true">
            {initialsFor(identity.name)}
          </span>
          <div>
            <h2>{identity.name}</h2>
            <p className="small muted">{subtitle}</p>
          </div>
        </div>
        <p className="small muted" style={{ marginTop: 24 }}>
          This private link shows only enough information to identify your record. Professional and contact details are
          available only inside the verified network.
        </p>
        <div className="divider" />
        {status === "submitted" ? (
          <div className="notice success" role="status">
            <Icon name="check" />
            <div>
              <p>
                <strong>Request received.</strong> {viewer?.email ? `${viewer.email} isn’t` : "Your email isn’t"} on file for this
                profile, so an administrator will confirm it’s you before linking it to your account.
              </p>
            </div>
          </div>
        ) : viewer ? (
          <>
            <p className="small">
              You’re signed in as <strong>{viewer.email}</strong>.
            </p>
            <div className="form-actions">
              <Link className="btn primary" href={`/claim/${token}/complete`} prefetch={false}>
                Claim my profile
              </Link>
            </div>
          </>
        ) : (
          <ClaimEmailForm token={token} />
        )}
      </section>
      <section style={{ marginTop: 32 }}>
        <h2>Prefer not to be included?</h2>
        <p className="small muted" style={{ margin: "12px 0" }}>
          You can remove your profile without creating an account. We’ll keep a minimal record only so it isn’t added again.
        </p>
        <Link className="btn quiet" href={`/remove/${token}`} prefetch={false}>
          Remove my profile <Icon name="arrow" />
        </Link>
      </section>
    </>
  );
}

export default function ClaimPage({ params, searchParams }: PageProps<"/claim/[token]">) {
  return (
    <>
      <PublicHeader />
      <main className="public-main">
        <div className="eyebrow accent" style={{ marginBottom: 16 }}>
          Your profile. Your choice.
        </div>
        <h1>Is this you?</h1>
        <p>Claim your alumni profile to confirm its details, choose what to share, and connect with other Wisconsin alumni.</p>
        <Suspense
          fallback={
            <section className="panel pad" role="status" aria-label="Loading">
              <div className="skeleton big" />
              <div className="skeleton" />
            </section>
          }
        >
          <ClaimPanel params={params} searchParams={searchParams} />
        </Suspense>
      </main>
    </>
  );
}
