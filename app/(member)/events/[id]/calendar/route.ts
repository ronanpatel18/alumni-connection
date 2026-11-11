import { buildCalendar, calendarResponse } from "@/lib/calendar";
import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/viewer";

/** A calendar file for one event (members only). */
export async function GET(_request: Request, { params }: RouteContext<"/events/[id]/calendar">) {
  await requireMember("/events");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const supabase = await createClient();
  const { data: e } = await supabase
    .from("events")
    .select("id, title, description, starts_at, ends_at, city, state, venue, url, cancelled_at")
    .eq("id", id)
    .maybeSingle<{ id: string; title: string; description: string | null; starts_at: string; ends_at: string | null; city: string | null; state: string | null; venue: string | null; url: string | null; cancelled_at: string | null }>();
  if (!e) return new Response("Not found", { status: 404 });
  return calendarResponse(
    buildCalendar([
      {
        uid: `event-${e.id}`,
        title: e.title,
        start: e.starts_at,
        end: e.ends_at ?? new Date(Date.parse(e.starts_at) + 2 * 3_600_000).toISOString(),
        location: [e.venue, [e.city, e.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || null,
        description: e.description,
        url: e.url,
        cancelled: Boolean(e.cancelled_at),
      },
    ]),
    "event.ics",
  );
}
