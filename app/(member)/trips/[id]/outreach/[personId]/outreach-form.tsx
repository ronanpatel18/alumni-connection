"use client";

import { useActionState, useState } from "react";
import { DialogButton } from "@/components/dialog-button";
import { Icon } from "@/components/icon";
import { type MessageState, startConversation } from "@/app/(member)/messages/actions";
import { type DraftState, saveDraft } from "../../../actions";

interface Props {
  /** True when the recipient is a member, so the message can go through Alumni Connect. */
  canMessage: boolean;
  tripId: string;
  personId: string;
  recipientName: string;
  subject: string;
  body: string;
  aiDrafted: boolean;
  email: string | null;
  linkedin: string | null;
  tripStart: string;
  timeZone: string;
}

/** Builds a tentative .ics invitation in the browser (nothing is booked or sent). */
function buildIcs({ title, date, time, minutes, zone, location }: { title: string; date: string; time: string; minutes: number; zone: string; location: string }) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const [h, m] = time.split(":").map(Number);
  const startMinutes = h * 60 + m;
  const endMinutes = startMinutes + minutes;
  const dayOffset = Math.floor(endMinutes / 1440);
  const endDate = new Date(`${date}T12:00:00Z`);
  endDate.setUTCDate(endDate.getUTCDate() + dayOffset);
  const stamp = (d: string, mins: number) => `${d.replaceAll("-", "")}T${pad(Math.floor((mins % 1440) / 60))}${pad(mins % 60)}00`;
  const escape = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Alumni Connect//Trips//EN",
    "BEGIN:VEVENT",
    `UID:${crypto.randomUUID()}@alumni-connect`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`,
    `DTSTART;TZID=${zone}:${stamp(date, startMinutes)}`,
    `DTEND;TZID=${zone}:${stamp(endDate.toISOString().slice(0, 10), endMinutes)}`,
    `SUMMARY:${escape(title)}`,
    `LOCATION:${escape(location)}`,
    "DESCRIPTION:Confirm this time with your contact before sending.",
    "STATUS:TENTATIVE",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

export function OutreachForm(props: Props) {
  const [state, action, pending] = useActionState<DraftState, FormData>(saveDraft, { status: "idle" });
  const [subject, setSubject] = useState(props.subject);
  const [body, setBody] = useState(props.body);
  const [copied, setCopied] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  // Same subject and body, sent as a private message (then opens the conversation).
  const [sendState, sendAction, sending] = useActionState<MessageState, FormData>(startConversation, { status: "idle" });
  const edited = subject !== props.subject || body !== props.body;
  const showAiLabel = props.aiDrafted && !edited && state.status !== "saved";

  async function copy() {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  function downloadInvite(form: HTMLFormElement) {
    const data = new FormData(form);
    const title = String(data.get("title") ?? "").trim();
    const date = String(data.get("date") ?? "");
    const time = String(data.get("time") ?? "");
    if (!title || !date || !time) {
      setInviteError("Add a meeting title, date and start time.");
      return;
    }
    setInviteError(null);
    const ics = buildIcs({
      title,
      date,
      time,
      minutes: Number(data.get("minutes") ?? 30),
      zone: String(data.get("zone") ?? props.timeZone),
      location: String(data.get("location") ?? ""),
    });
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[^\w ]+/g, "").trim() || "meeting"}.ics`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  return (
    <section className="panel pad">
      <form action={action}>
        <input type="hidden" name="trip_id" value={props.tripId} />
        <input type="hidden" name="person_id" value={props.personId} />
        <div className="section-head">
          <h2>Your message</h2>
          {showAiLabel ? <span className="chip ai">AI-drafted · Editable</span> : <span className="chip">Your draft</span>}
        </div>
        <div className="field">
          <label htmlFor="subject">Subject</label>
          <input id="subject" name="subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} required />
        </div>
        <div className="field" style={{ marginTop: 24 }}>
          <label htmlFor="body">Message</label>
          <textarea
            id="body"
            name="body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={5000}
            required
            rows={12}
            aria-describedby="body-help"
          />
          <small id="body-help">Check the details and make it sound like you before sending.</small>
        </div>

        <div className="notice" style={{ marginTop: 24 }}>
          <Icon name="lock" />
          <div>
            {props.canMessage ? (
              <p>
                {props.recipientName.split(" ")[0]} is a member, so you can send this through Alumni Connect. They get an email saying they
                have a message and reply here; neither of your addresses is shared.
              </p>
            ) : (
              <>
                <p>{props.recipientName.split(" ")[0]} hasn’t joined Alumni Connect yet, so it can’t carry this message.</p>
                <p>Send it yourself from your email or LinkedIn. Saving keeps your draft here.</p>
              </>
            )}
          </div>
        </div>

        <div aria-live="polite" style={{ marginTop: 16 }}>
          {state.status === "saved" && (
            <div className="notice success">
              <Icon name="check" />
              <div>Draft saved. Nothing was sent.</div>
            </div>
          )}
          {state.status === "error" && (
            <div className="notice error" role="alert">
              <Icon name="info" />
              <div>{state.message}</div>
            </div>
          )}
          {sendState.status === "error" && (
            <div className="notice error" role="alert">
              <Icon name="info" />
              <div>{sendState.message}</div>
            </div>
          )}
        </div>

        <div className="form-actions">
          {props.canMessage && (
            <button type="submit" formAction={sendAction} className="btn primary" disabled={sending || pending}>
              <Icon name="mail" /> {sending ? "Sending…" : "Send through Alumni Connect"}
            </button>
          )}
          <button type="submit" className={props.canMessage ? "btn" : "btn primary"} disabled={pending || sending}>
            {pending ? "Saving…" : "Save draft"}
          </button>
          <button type="button" className="btn" onClick={copy}>
            <Icon name={copied ? "check" : "file"} /> {copied ? "Copied" : "Copy message"}
          </button>
          {props.email && (
            <a className="btn" href={`mailto:${props.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}>
              <Icon name="mail" /> Open in email
            </a>
          )}
          {props.linkedin && (
            <a className="btn" href={props.linkedin} target="_blank" rel="noopener noreferrer">
              <Icon name="linkedin" /> Message on LinkedIn
            </a>
          )}
        </div>
      </form>

      <div className="divider" />
      <h3>After they say yes</h3>
      <p className="small muted" style={{ margin: "8px 0 16px" }}>
        Agree on a time together first, then add it to both calendars.
      </p>
      <DialogButton label="Prepare a calendar invitation" title={`Meeting with ${props.recipientName}`} className="btn">
        <p className="small muted">This downloads a tentative .ics file. It doesn’t book a time or send an invitation.</p>
        <form
          className="form-grid"
          style={{ marginTop: 16 }}
          onSubmit={(e) => {
            e.preventDefault();
            downloadInvite(e.currentTarget);
          }}
        >
          <div className="field full">
            <label htmlFor="invite-title">Meeting title</label>
            <input id="invite-title" name="title" defaultValue={`Coffee with ${props.recipientName}`} required />
          </div>
          <div className="field">
            <label htmlFor="invite-date">Date</label>
            <input id="invite-date" name="date" type="date" defaultValue={props.tripStart} required />
          </div>
          <div className="field">
            <label htmlFor="invite-time">Start time</label>
            <input id="invite-time" name="time" type="time" defaultValue="10:00" required />
          </div>
          <div className="field">
            <label htmlFor="invite-minutes">Duration</label>
            <select id="invite-minutes" name="minutes" defaultValue="30">
              <option value="30">30 minutes</option>
              <option value="45">45 minutes</option>
              <option value="60">60 minutes</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="invite-zone">Time zone</label>
            <select id="invite-zone" name="zone" defaultValue={props.timeZone}>
              {["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "Pacific/Honolulu"].map((z) => (
                <option key={z} value={z}>
                  {z.replace("_", " ")}
                </option>
              ))}
            </select>
          </div>
          <div className="field full">
            <label htmlFor="invite-location">Location or meeting link</label>
            <input id="invite-location" name="location" defaultValue="To be agreed" />
          </div>
          {inviteError && (
            <p className="error-text full" role="alert">
              {inviteError}
            </p>
          )}
          <div className="form-actions full" style={{ marginTop: 0 }}>
            <button type="submit" className="btn primary">
              Download invitation
            </button>
          </div>
        </form>
      </DialogButton>
    </section>
  );
}
