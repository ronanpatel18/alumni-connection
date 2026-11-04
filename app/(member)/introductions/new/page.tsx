import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { initialsFor } from "@/components/account-block";
import { EmptyState, PageTitle } from "@/components/person";
import { RelationshipTabs } from "@/components/relationship-tabs";
import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/viewer";
import { RequestForm } from "./request-form";

export const metadata: Metadata = { title: "Request an introduction" };

interface Connector {
  person_id: string;
  full_name: string;
  headline: string | null;
  photo_url: string | null;
  shared: string;
}

async function NewIntro({ searchParams }: { searchParams: PageProps<"/introductions/new">["searchParams"] }) {
  const viewer = await requireMember("/introductions");
  const { person } = await searchParams;
  if (typeof person !== "string" || !/^[0-9a-f-]{36}$/i.test(person)) notFound();
  const supabase = await createClient();
  const [{ data: target }, { data: connectors }] = await Promise.all([
    supabase
      .from("people")
      .select("id, full_name, current_title, organizations:current_organization_id(name)")
      .eq("id", person)
      .maybeSingle<{ id: string; full_name: string; current_title: string | null; organizations: { name: string } | null }>(),
    supabase.rpc("intro_connectors", { p_target: person }),
  ]);
  if (!target) notFound();
  const list = (connectors ?? []) as Connector[];
  const first = target.full_name.split(" ")[0];
  const role = [target.current_title, target.organizations?.name].filter(Boolean).join(" at ");

  return (
    <div className="split">
      <div className="stack">
        <section className="panel pad">
          <div className="network-graphic" aria-label={`You, then a connector, then ${target.full_name}`}>
            <span className="avatar small red">{initialsFor(viewer.email ?? "You")}</span>
            <span className="network-line" />
            <span className="avatar">?</span>
            <span className="network-line" />
            <span className="avatar small">{initialsFor(target.full_name)}</span>
          </div>
          <h2>You → someone you both know → {target.full_name}</h2>
          {role && <p className="small muted" style={{ marginTop: 8 }}>{role}</p>}
          <ol className="steps" style={{ marginTop: 24, marginBottom: 0 }}>
            <li className="step active">
              <b>1</b>
              <span>Connector agrees</span>
            </li>
            <li className="step">
              <b>2</b>
              <span>{first} agrees</span>
            </li>
            <li className="step">
              <b>3</b>
              <span>Introduction made</span>
            </li>
          </ol>
        </section>
        {list.length ? (
          <RequestForm
            targetId={target.id}
            targetName={target.full_name}
            connectors={list}
            defaultGoal={`I’d value ${first}’s perspective${role ? ` as ${role}` : ""}, and would like to explore where our work overlaps.`}
          />
        ) : (
          <section className="panel">
            <EmptyState
              title={`No one who knows ${first} has joined yet`}
              text="Introductions go through a member who knows them, such as someone on the same board. When one claims their profile, you can ask them here."
              action={
                <Link className="btn" href={`/people/${target.id}`}>
                  Back to profile
                </Link>
              }
            />
          </section>
        )}
      </div>
      <aside className="right-rail stack">
        <section className="panel pad">
          <h2 className="rail-title">Two yeses, then hello</h2>
          <p className="small muted">
            Your connector decides first. Only if they agree is {first} asked. Nobody’s contact details are shared by asking, and a
            decline needs no reason.
          </p>
        </section>
      </aside>
    </div>
  );
}

export default function NewIntroPage({ searchParams }: PageProps<"/introductions/new">) {
  return (
    <>
      <PageTitle
        eyebrow="Relationships / Introductions"
        title="Start with someone you both know."
        description="A warm introduction takes two yeses. Nobody is connected without their consent."
      />
      <RelationshipTabs />
      <Suspense fallback={<div className="panel pad"><div className="skeleton big" /><div className="skeleton" /></div>}>
        <NewIntro searchParams={searchParams} />
      </Suspense>
    </>
  );
}
