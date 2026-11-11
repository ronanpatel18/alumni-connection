import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { EmptyState, PageTitle } from "@/components/person";
import { RelationshipTabs } from "@/components/relationship-tabs";
import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/viewer";
import { ComposeForm } from "../message-forms";

export const metadata: Metadata = { title: "New message" };

async function Compose({ searchParams }: { searchParams: PageProps<"/messages/new">["searchParams"] }) {
  const viewer = await requireMember("/messages");
  const { person, subject } = await searchParams;
  const about = typeof subject === "string" ? subject.trim().slice(0, 200) : "";
  if (typeof person !== "string" || !/^[0-9a-f-]{36}$/i.test(person)) notFound();
  const supabase = await createClient();
  const { data: target } = await supabase
    .from("people")
    .select("id, full_name, status, claimed_by_user_id")
    .eq("id", person)
    .maybeSingle<{ id: string; full_name: string; status: string; claimed_by_user_id: string | null }>();
  if (!target) notFound();
  const first = target.full_name.split(" ")[0];

  if (target.claimed_by_user_id === viewer.userId) {
    return <EmptyState title="That’s your own profile" text="Messages go to other members." />;
  }
  if (target.status !== "claimed" && target.status !== "verified") {
    return (
      <section className="panel">
        <EmptyState
          title={`${first} hasn’t joined yet`}
          text="Messages can only reach members. Use a contact detail they’ve made visible, or ask a member who knows them for an introduction."
          action={
            <Link className="btn" href={`/people/${target.id}`}>
              Back to profile
            </Link>
          }
        />
      </section>
    );
  }
  return (
    <section className="panel pad narrow">
      <h2 style={{ marginBottom: 16 }}>To {target.full_name}</h2>
      <ComposeForm personId={target.id} recipientName={target.full_name} subject={about || "A hello from a fellow Wisconsin alum"} />
    </section>
  );
}

export default function NewMessagePage({ searchParams }: PageProps<"/messages/new">) {
  return (
    <>
      <PageTitle
        eyebrow="Relationships / Messages"
        title="A thoughtful first hello."
        description="Say why you’re reaching out, ask for something specific, and leave room for a gracious no."
      />
      <RelationshipTabs />
      <Suspense fallback={<div className="panel pad"><div className="skeleton big" /></div>}>
        <Compose searchParams={searchParams} />
      </Suspense>
    </>
  );
}
