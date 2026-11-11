// Calendar files (RFC 5545) and "add to calendar" links. Pure functions.

export interface CalendarEntry {
  /** Stable across downloads, so re-importing updates the entry instead of duplicating it. */
  uid: string;
  title: string;
  /** ISO timestamp, or YYYY-MM-DD for an all-day entry. */
  start: string;
  /** ISO timestamp; ignored for all-day entries. Defaults to 30 minutes after start. */
  end?: string | null;
  location?: string | null;
  description?: string | null;
  url?: string | null;
  cancelled?: boolean;
}

const escapeText = (text: string) => text.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/([,;])/g, "\\$1");
const stamp = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const isDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

/** Lines longer than 75 bytes are folded, as the format requires. */
function fold(line: string): string {
  const parts: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest) > 74) {
    let cut = 74;
    while (Buffer.byteLength(rest.slice(0, cut)) > 74) cut--;
    parts.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  parts.push(rest);
  return parts.join("\r\n");
}

function entryLines(e: CalendarEntry, now: Date): string[] {
  const lines = ["BEGIN:VEVENT", `UID:${e.uid}@alumni-connect`, `DTSTAMP:${stamp(now)}`];
  if (isDay(e.start)) {
    const next = new Date(`${e.start}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    lines.push(`DTSTART;VALUE=DATE:${e.start.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replace(/-/g, "")}`);
  } else {
    const start = new Date(e.start);
    const end = e.end ? new Date(e.end) : new Date(start.getTime() + 30 * 60_000);
    lines.push(`DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`);
  }
  lines.push(`SUMMARY:${escapeText(e.title)}`);
  if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
  if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
  if (e.url) lines.push(`URL:${e.url}`);
  lines.push(`STATUS:${e.cancelled ? "CANCELLED" : "CONFIRMED"}`, "END:VEVENT");
  return lines;
}

export function buildCalendar(entries: CalendarEntry[], { name = "Alumni Connect", now = new Date() } = {}): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Alumni Connect//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${escapeText(name)}`];
  for (const entry of entries) lines.push(...entryLines(entry, now));
  lines.push("END:VCALENDAR");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

/** Opens Google Calendar's new-event page with the details filled in. */
export function googleCalendarLink(e: Pick<CalendarEntry, "title" | "start" | "end" | "location" | "description">): string {
  const start = new Date(e.start);
  const end = e.end ? new Date(e.end) : new Date(start.getTime() + 30 * 60_000);
  const params = new URLSearchParams({ action: "TEMPLATE", text: e.title, dates: `${stamp(start)}/${stamp(end)}` });
  if (e.location) params.set("location", e.location);
  if (e.description) params.set("details", e.description);
  return `https://calendar.google.com/calendar/render?${params}`;
}

export const calendarResponse = (body: string, fileName: string) =>
  new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });

/** "Tuesday, November 17, 2026", from a date or timestamp, read in UTC so server and browser agree. */
export function formatDay(value: string): string {
  return new Date(isDay(value) ? `${value}T12:00:00Z` : value).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}
