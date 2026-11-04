"use client";

import { useActionState } from "react";
import { Icon } from "@/components/icon";
import { type MessageState, sendReply, startConversation } from "./actions";

function ErrorNotice({ state }: { state: MessageState }) {
  if (state.status !== "error") return null;
  return (
    <div className="notice error" role="alert">
      <Icon name="info" />
      <div>{state.message}</div>
    </div>
  );
}

/** A first message to a member. Also used from a trip's outreach page with the draft filled in. */
export function ComposeForm({
  personId,
  recipientName,
  subject = "",
  body = "",
  tripId = "",
  submitLabel = "Send through Alumni Connect",
}: {
  personId: string;
  recipientName: string;
  subject?: string;
  body?: string;
  tripId?: string;
  submitLabel?: string;
}) {
  const [state, action, pending] = useActionState<MessageState, FormData>(startConversation, { status: "idle" });
  const first = recipientName.split(" ")[0];
  return (
    <form key={state.status === "error" ? state.attempt : 0} action={action} className="stack">
      <input type="hidden" name="person_id" value={personId} />
      <input type="hidden" name="trip_id" value={tripId} />
      <ErrorNotice state={state} />
      <div className="field">
        <label htmlFor="compose-subject">Subject</label>
        <input id="compose-subject" name="subject" defaultValue={subject} maxLength={200} />
      </div>
      <div className="field">
        <label htmlFor="compose-body">Message</label>
        <textarea id="compose-body" name="body" defaultValue={state.status === "error" ? (state.body ?? body) : body} maxLength={5000} rows={10} required />
        <small>
          {first} gets an email saying they have a message, and replies here. Neither of your email addresses is shared.
        </small>
      </div>
      <div className="form-actions" style={{ marginTop: 0 }}>
        <button type="submit" className="btn primary" disabled={pending}>
          {pending ? "Sending…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

export function ReplyForm({ conversationId }: { conversationId: string }) {
  const [state, action, pending] = useActionState<MessageState, FormData>(sendReply, { status: "idle" });
  // A new key after each send (or error) gives a fresh, empty box; an error keeps what was typed.
  const key = state.status === "sent" ? `s${state.count}` : state.status === "error" ? `e${state.attempt}` : "0";
  return (
    <form key={key} action={action} className="stack reply-form">
      <input type="hidden" name="conversation_id" value={conversationId} />
      <ErrorNotice state={state} />
      <div className="field">
        <label htmlFor="reply-body">Reply</label>
        <textarea id="reply-body" name="body" defaultValue={state.status === "error" ? (state.body ?? "") : ""} maxLength={5000} rows={4} required />
      </div>
      <div className="form-actions" style={{ marginTop: 0 }}>
        <button type="submit" className="btn primary" disabled={pending}>
          {pending ? "Sending…" : "Send reply"}
        </button>
      </div>
    </form>
  );
}
