import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Icon } from "@/components/icon";
import { PageTitle } from "@/components/person";
import { RelationshipTabs } from "@/components/relationship-tabs";
import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/viewer";
import { ReplyForm } from "../message-forms";

export const metadata: Metadata = { title: "Conversation" };

async function Thread({ params, searchParams }: { params: PageProps<"/messages/[id]">["params"]; searchParams: PageProps<"/messages/[id]">["searchParams"] }) {
  const { id } = await params;
  const { sent } = await searchParams;
  const viewer = await requireMember(`/messages/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: list }, { data: messages }] = await Promise.all([
    supabase.rpc("my_conversations"),
    supabase.from("messages").select("id, sender_user_id, body, created_at").eq("conversation_id", id).order("id"),
  ]);
  const convo = ((list ?? []) as { id: string; subject: string; other_name: string; other_person_id: string | null }[]).find((c) => c.id === id);
  if (!convo) notFound();
  // Opening the conversation marks it read (and its notification).
  await supabase.rpc("mark_conversation_read", { p_conversation: id });

  return (
    <div className="split">
      <section className="panel pad stack">
        {sent === "1" && (
          <div className="notice success" role="status">
            <Icon name="check" />
            <div>Sent. {convo.other_name.split(" ")[0]} will get an email saying they have a message. Sending it doesn’t share your address.</div>
          </div>
        )}
        <div>
          <h2>{convo.subject}</h2>
          <p className="meta" style={{ marginTop: 4 }}>
            With {convo.other_person_id ? <Link href={`/people/${convo.other_person_id}`}>{convo.other_name}</Link> : convo.other_name}
          </p>
        </div>
        <ol className="thread" aria-label="Messages">
          {(messages ?? []).map((m) => {
            const mine = m.sender_user_id === viewer.userId;
            return (
              <li key={m.id} className={`bubble${mine ? " mine" : ""}`}>
                <span className="meta">
                  {mine ? "You" : convo.other_name} · {new Date(m.created_at as string).toLocaleString()}
                </span>
                <p className="bio">{m.body as string}</p>
              </li>
            );
          })}
        </ol>
        <ReplyForm conversationId={id} />
      </section>
      <aside className="right-rail stack">
        <section className="panel pad">
          <h2 className="rail-title">Private by design</h2>
          <p className="small muted">
            Messages stay in Alumni Connect. Email notifications say who wrote, never what they said, and neither address is shared. Share
            your own contact details in a message only if you want to.
          </p>
        </section>
      </aside>
    </div>
  );
}

export default function ConversationPage({ params, searchParams }: PageProps<"/messages/[id]">) {
  return (
    <>
      <PageTitle eyebrow="Relationships / Messages" title="Conversations, kept private." />
      <RelationshipTabs />
      <Suspense fallback={<div className="panel pad"><div className="skeleton big" /><div className="skeleton" /></div>}>
        <Thread params={params} searchParams={searchParams} />
      </Suspense>
    </>
  );
}
