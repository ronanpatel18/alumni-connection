import { buildCalendar, type CalendarEntry, calendarResponse } from "@/lib/calendar";
import { publicEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * A member's private calendar feed: booked meetings, events they're going to
 * or hosting, and open follow-up dates. Calendar apps fetch it without signing
 * in, so the long random token in the address is what proves whose it is.
 */
export async function GET(_request: Request, { params }: RouteContext<"/calendar/[token]">) {
  const { token } = await params;
  if (!/^[0-9a-f]{64}$/.test(token)) return new Response("Not found", { status: 404 });
  const db = createAdminClient();
  const { data: feed } = await db.from("calendar_feeds").select("user_id").eq("token", token).maybeSingle<{ user_id: string }>();
  if (!feed) return new Response("Not found", { status: 404 });
  const user = feed.user_id;
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const [{ data: meetings }, { data: rsvps }, { data: hosted }, { data: followUps }] = await Promise.all([
    db
      .from("meetings")
      .select("id, title, starts_at, duration_minutes, location, note, proposed_by, with_user")
      .or(`proposed_by.eq.${user},with_user.eq.${user}`)
      .eq("status", "accepted")
      .gte("starts_at", since)
      .returns<{ id: string; title: string; starts_at: string; duration_minutes: number; location: string | null; note: string | null; proposed_by: string; with_user: string }[]>(),
    db.from("event_rsvps").select("events!inner(id, title, description, starts_at, ends_at, city, state, venue, url, cancelled_at)").eq("user_id", user).gte("events.starts_at", since),
    db.from("events").select("id, title, description, starts_at, ends_at, city, state, venue, url, cancelled_at").eq("created_by", user).gte("starts_at", since),
    db
      .from("interactions")
      .select("id, follow_up_at, summary, people!inner(full_name, status)")
      .eq("owner_user_id", user)
      .is("follow_up_done_at", null)
      .not("follow_up_at", "is", null)
      .gte("follow_up_at", since)
      .returns<{ id: string; follow_up_at: string; summary: string | null; people: { full_name: string; status: string } }[]>(),
  ]);

  const others = [...new Set((meetings ?? []).map((m) => (m.proposed_by === user ? m.with_user : m.proposed_by)))];
  const { data: names } = others.length
    ? await db.from("people").select("claimed_by_user_id, full_name").in("claimed_by_user_id", others).returns<{ claimed_by_user_id: string; full_name: string }[]>()
    : { data: [] };
  const nameOf = new Map((names ?? []).map((p) => [p.claimed_by_user_id, p.full_name]));

  interface EventRow {
    id: string;
    title: string;
    description: string | null;
    starts_at: string;
    ends_at: string | null;
    city: string | null;
    state: string | null;
    venue: string | null;
    url: string | null;
    cancelled_at: string | null;
  }
  const events = new Map<string, EventRow>();
  for (const row of (rsvps ?? []) as unknown as { events: EventRow }[]) events.set(row.events.id, row.events);
  for (const row of (hosted ?? []) as EventRow[]) events.set(row.id, row);

  const entries: CalendarEntry[] = [
    ...(meetings ?? []).map((m) => ({
      uid: `meeting-${m.id}`,
      title: `${m.title} (${nameOf.get(m.proposed_by === user ? m.with_user : m.proposed_by) ?? "a member"})`,
      start: m.starts_at,
      end: new Date(Date.parse(m.starts_at) + m.duration_minutes * 60_000).toISOString(),
      location: m.location,
      description: m.note,
    })),
    ...[...events.values()].map((e) => ({
      uid: `event-${e.id}`,
      title: e.title,
      start: e.starts_at,
      end: e.ends_at ?? new Date(Date.parse(e.starts_at) + 2 * 3_600_000).toISOString(),
      location: [e.venue, [e.city, e.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || null,
      description: e.description,
      url: e.url ?? `${publicEnv.NEXT_PUBLIC_SITE_URL}/events`,
      cancelled: Boolean(e.cancelled_at),
    })),
    ...(followUps ?? [])
      .filter((f) => f.people.status !== "opted_out")
      .map((f) => ({ uid: `follow-up-${f.id}`, title: `Follow up with ${f.people.full_name}`, start: f.follow_up_at.slice(0, 10), description: f.summary, url: `${publicEnv.NEXT_PUBLIC_SITE_URL}/followups` })),
  ];
  const response = calendarResponse(buildCalendar(entries, { name: "Alumni Connect" }), "alumni-connect.ics");
  response.headers.set("Content-Disposition", 'inline; filename="alumni-connect.ics"');
  return response;
}
