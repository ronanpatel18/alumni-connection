import { describe, expect, it } from "vitest";
import { buildCalendar, formatDay, googleCalendarLink } from "@/lib/calendar";

const now = new Date("2026-11-12T10:00:00Z");

describe("calendar files", () => {
  it("writes a timed entry in UTC with escaped text", () => {
    const ics = buildCalendar([{ uid: "meeting-1", title: "Coffee; with Sam, at noon", start: "2026-11-20T18:00:00.000Z", end: "2026-11-20T18:30:00.000Z", location: "Memorial Union", description: "Line one\nLine two" }], { now });
    expect(ics).toContain("BEGIN:VCALENDAR\r\nVERSION:2.0");
    expect(ics).toContain("UID:meeting-1@alumni-connect");
    expect(ics).toContain("DTSTART:20261120T180000Z\r\nDTEND:20261120T183000Z");
    expect(ics).toContain(String.raw`SUMMARY:Coffee\; with Sam\, at noon`);
    expect(ics).toContain("DESCRIPTION:Line one\\nLine two");
    expect(ics).toContain("STATUS:CONFIRMED");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("writes an all-day entry for a date, and marks cancelled ones", () => {
    const ics = buildCalendar([{ uid: "follow-up-1", title: "Follow up with Sam", start: "2026-12-31", cancelled: true }], { now });
    expect(ics).toContain("DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101");
    expect(ics).toContain("STATUS:CANCELLED");
  });

  it("defaults to half an hour and folds long lines", () => {
    const ics = buildCalendar([{ uid: "x", title: "T", start: "2026-11-20T18:00:00Z", description: "word ".repeat(40) }], { now });
    expect(ics).toContain("DTEND:20261120T183000Z");
    for (const line of ics.split("\r\n")) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    expect(ics.replace(/\r\n /g, "")).toContain(`DESCRIPTION:${"word ".repeat(40).trimEnd()}`.slice(0, 60));
  });

  it("builds a Google Calendar link", () => {
    const url = new URL(googleCalendarLink({ title: "Coffee", start: "2026-11-20T18:00:00Z", location: "Union" }));
    expect(url.searchParams.get("dates")).toBe("20261120T180000Z/20261120T183000Z");
    expect(url.searchParams.get("text")).toBe("Coffee");
    expect(url.searchParams.get("location")).toBe("Union");
  });

  it("formats a day the same on any machine", () => {
    expect(formatDay("2026-11-17")).toBe("Tuesday, November 17, 2026");
    expect(formatDay("2026-11-17T15:00:00Z")).toBe("Tuesday, November 17, 2026");
  });
});
