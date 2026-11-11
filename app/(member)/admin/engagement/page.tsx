import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminTabs } from "@/components/admin-tabs";
import { Icon } from "@/components/icon";
import { PageTitle } from "@/components/person";
import { formatDay } from "@/lib/calendar";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/viewer";

export const metadata: Metadata = { title: "Engagement" };

interface Metrics {
  members: number;
  new_members_30d: number;
  active_30d: number;
  profiles: number;
  claimed_profiles: number;
  last_30d: Record<string, number>;
  weekly: { week: string; active: number; joined: number }[];
}

const ACTIVITY: [key: string, label: string, note?: string][] = [
  ["messages", "Messages sent"],
  ["conversations", "New conversations"],
  ["saved", "Contacts saved"],
  ["intros_asked", "Introductions asked for"],
  ["intros_made", "Introductions made", "Both people agreed"],
  ["meetings_proposed", "Meetings proposed"],
  ["meetings_booked", "Meetings booked", "The invited person accepted"],
  ["follow_ups", "Conversations logged"],
  ["trips", "Trips planned"],
  ["events", "Events posted"],
  ["rsvps", "Event RSVPs"],
  ["jobs", "Jobs posted"],
  ["businesses", "Businesses listed"],
  ["mentorships_asked", "Mentors asked"],
  ["mentorships_agreed", "Mentorships agreed"],
];

const percent = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "–");

async function Engagement() {
  await requireAdmin("/admin/engagement");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_engagement_metrics");
  if (error || !data) {
    return (
      <div className="notice error" role="alert">
        <Icon name="info" />
        <div>The numbers couldn’t be loaded. Refresh to try again.</div>
      </div>
    );
  }
  const m = data as Metrics;
  const peak = Math.max(1, ...m.weekly.map((w) => Math.max(w.active, w.joined)));

  return (
    <div className="stack">
      <section className="panel">
        <div className="summary-strip" style={{ borderBottom: 0 }}>
          <div>
            <strong>{m.members}</strong>
            <br />
            <span>Verified members · {m.new_members_30d} joined in the last 30 days</span>
          </div>
          <div>
            <strong>{m.active_30d}</strong>
            <br />
            <span>Active in the last 30 days · {percent(m.active_30d, m.members)} of members</span>
          </div>
          <div>
            <strong>{m.claimed_profiles}</strong>
            <br />
            <span>
              Profiles claimed · {percent(m.claimed_profiles, m.profiles)} of {m.profiles} in the directory
            </span>
          </div>
        </div>
      </section>
      <section className="panel pad">
        <h2>Week by week</h2>
        <p className="meta" style={{ marginTop: 8 }}>
          Members who did at least one thing that week, for the last eight weeks.
        </p>
        {m.weekly.map((w) => (
          <div key={w.week} className="bar-row">
            <span className="meta">{formatDay(w.week).replace(/^\w+, /, "").replace(/, \d{4}$/, "")}</span>
            <div className="bar-track" role="img" aria-label={`${w.active} active, ${w.joined} joined`}>
              <div className="bar-confirmed" style={{ width: `${(w.active / peak) * 100}%` }} />
            </div>
            <span className="mono">{w.active}</span>
          </div>
        ))}
      </section>
      <section className="panel">
        <div className="table-title">
          <h2>What members did in the last 30 days</h2>
          <p className="meta" style={{ marginTop: 8 }}>
            Counts only. Who messaged whom, private notes and saved lists are never shown here.
          </p>
        </div>
        <div className="table-wrap">
          <table className="responsive">
            <thead>
              <tr>
                <th>Activity</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {ACTIVITY.map(([key, label, note]) => (
                <tr key={key}>
                  <td data-label="Activity">
                    {label}
                    {note && <p className="meta">{note}</p>}
                  </td>
                  <td data-label="Count" className="mono">
                    {m.last_30d[key] ?? 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default function EngagementPage() {
  return (
    <>
      <PageTitle
        eyebrow="Administration / Engagement"
        title="Is the network being used?"
        description="How many members are active, and what they’re doing: messages, introductions, meetings, events and more."
      />
      <AdminTabs />
      <Suspense fallback={<div className="panel pad"><div className="skeleton big" /><div className="skeleton" /><div className="skeleton short" /></div>}>
        <Engagement />
      </Suspense>
    </>
  );
}
