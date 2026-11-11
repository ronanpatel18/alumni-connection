import { buildCalendar, calendarResponse } from "@/lib/calendar";
import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/viewer";

interface Meeting {
  id: string;
  title: string;
  starts_at: string;
  duration_minutes: number;
  location: string | null;
  note: string | null;
  status: string;
  other_name: string;
}

/** A calendar file for one of the member's own booked meetings. */
export async function GET(_request: Request, { params }: RouteContext<"/meetings/[id]/calendar">) {
  await requireMember("/meetings");
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_meetings");
  const meeting = ((data ?? []) as Meeting[]).find((m) => m.id === id && m.status === "accepted");
  if (!meeting) return new Response("Not found", { status: 404 });
  return calendarResponse(
    buildCalendar([
      {
        uid: `meeting-${meeting.id}`,
        title: `${meeting.title} (${meeting.other_name})`,
        start: meeting.starts_at,
        end: new Date(Date.parse(meeting.starts_at) + meeting.duration_minutes * 60_000).toISOString(),
        location: meeting.location,
        description: meeting.note,
      },
    ]),
    "meeting.ics",
  );
}
