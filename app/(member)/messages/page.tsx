import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyState, PageTitle } from "@/components/person";
import { RelationshipTabs } from "@/components/relationship-tabs";
import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/viewer";

export const metadata: Metadata = { title: "Messages" };

interface ConversationRow {
  id: string;
  subject: string;
  other_name: string;
  other_person_id: string | null;
  last_message_at: string;
  last_body: string | null;
  unread: boolean;
}

async function Conversations() {
  await requireMember("/messages");
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_conversations");
  const rows = (data ?? []) as ConversationRow[];
  if (!rows.length) {
    return (
      <section className="panel">
        <EmptyState
          title="No messages yet"
          text="Message a member from their profile, or from a trip shortlist. Your email address is never shared; replies happen here."
          action={
            <Link className="btn primary" href="/discover/who-to-meet">
              Find people worth meeting
            </Link>
          }
        />
      </section>
    );
  }
  return (
    <section className="panel">
      {rows.map((c) => (
        <Link key={c.id} href={`/messages/${c.id}`} className={`intro-row${c.unread ? " unread" : ""}`}>
          <strong>
            {c.other_name}
            {c.unread && <span className="badge-count" style={{ marginLeft: 8 }}>New</span>}
          </strong>
          <span className="small">{c.subject}</span>
          <span className="meta">
            {c.last_body ? `${c.last_body}${c.last_body.length >= 140 ? "…" : ""} · ` : ""}
            {new Date(c.last_message_at).toLocaleDateString()}
          </span>
        </Link>
      ))}
    </section>
  );
}

export default function MessagesPage() {
  return (
    <>
      <PageTitle
        eyebrow="Relationships / Messages"
        title="Conversations, kept private."
        description="Messages stay in Alumni Connect. Members get an email when you write, and nobody’s address is shared."
      />
      <RelationshipTabs />
      <Suspense fallback={<div className="panel pad"><div className="skeleton big" /><div className="skeleton" /></div>}>
        <Conversations />
      </Suspense>
    </>
  );
}
