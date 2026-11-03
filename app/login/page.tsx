import type { Metadata } from "next";
import { Suspense } from "react";
import { Brand } from "@/components/brand";
import { Icon } from "@/components/icon";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

async function LoginContent({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const { next, error } = await searchParams;
  const safeNext = typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/discover";
  return <LoginForm next={safeNext} linkError={error === "link"} />;
}

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="auth-shell">
      <section className="auth-story">
        <Brand href="/" />
        <div>
          <div className="eyebrow accent" style={{ marginBottom: 24 }}>
            Your alumni network, nationwide.
          </div>
          <h1>
            A shared beginning.
            <br />
            <span className="accent">A world of possibility.</span>
          </h1>
          <p className="muted" style={{ maxWidth: "40ch", marginTop: 24 }}>
            Build professional relationships with people who share your Wisconsin story.
          </p>
        </div>
        <p className="small muted story-foot">Private by design. Open only to verified UW–Madison alumni.</p>
      </section>
      <section className="auth-form">
        <div id="auth-content">
          <Suspense>
            <LoginContent searchParams={searchParams} />
          </Suspense>
        </div>
        <div className="auth-footer">
          <Icon name="lock" /> Profiles are private and are never indexed by search engines.
        </div>
      </section>
    </main>
  );
}
