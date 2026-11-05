import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { nameKey, parseRoster, previewRoster, type RosterRow } from "@/lib/importers/roster";

const rows = (csv: string) => {
  const parsed = parseRoster(csv, "WSB roster");
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.rows;
};
const row = (over: Partial<RosterRow> = {}): RosterRow => ({
  row: 1,
  name: "Pat Example",
  email: "pat@example.com",
  classYear: "2010",
  title: "Director",
  employer: "Acme",
  city: "Chicago",
  state: "IL",
  linkedin: "",
  source: "WSB roster",
  ...over,
});
const directory = [{ id: "d1", fullName: "John J. Oros", emails: ["john@example.com"], linkedins: ["https://www.linkedin.com/in/johnjoros/"] }];
const statusOf = (r: RosterRow) => previewRoster([r], directory, []).rows[0];

describe("parseRoster", () => {
  it("reads common column names, quoted values and a byte-order mark", () => {
    const [first] = rows('﻿Full Name,E-mail,Grad Year,Job Title,Company,City,State\n"Shah, Priya",priya@example.com,2009,VP,Acme,Madison,WI\n');
    expect(first).toMatchObject({ row: 1, name: "Shah, Priya", email: "priya@example.com", classYear: "2009", title: "VP", employer: "Acme", source: "WSB roster" });
  });

  it("joins first and last names, and prefers a row's own source", () => {
    expect(rows("first_name,last_name,source\nPriya,Shah,Chapter list\n")[0]).toMatchObject({ name: "Priya Shah", source: "Chapter list" });
  });

  it("numbers data rows, skips blank ones, and reports columns it ignored", () => {
    const parsed = parseRoster("name,shoe size\nA One,9\n,\nB Two,10\n", "x");
    expect(parsed).toMatchObject({ ok: true, ignoredColumns: ["shoe size"] });
    expect(parsed.ok && parsed.rows.map((r) => r.row)).toEqual([1, 2]);
  });

  it("explains a file with no name column, and an empty one", () => {
    expect(parseRoster("email\na@example.com\n", "x")).toMatchObject({ ok: false, message: expect.stringContaining("Name") });
    expect(parseRoster("", "x")).toMatchObject({ ok: false });
  });
});

describe("nameKey", () => {
  it("ignores middle names, suffixes, accents and case", () => {
    expect(nameKey("John J. Oros, Jr.")).toBe("john oros");
    expect(nameKey("JOSÉ García")).toBe("jose garcia");
  });
});

describe("previewRoster", () => {
  it("marks a complete, unknown person as new", () => {
    expect(statusOf(row())).toMatchObject({ status: "new", missing: [], detail: null });
  });

  it("finds likely duplicates by email, LinkedIn and name, and says which", () => {
    expect(statusOf(row({ name: "J. Oros", email: "JOHN@example.com" }))).toMatchObject({ status: "duplicate", matchId: "d1", detail: "Same email as John J. Oros" });
    expect(statusOf(row({ name: "J. Oros", linkedin: "linkedin.com/in/JohnJOros?x=1" })).detail).toBe("Same LinkedIn as John J. Oros");
    expect(statusOf(row({ name: "John Oros" })).detail).toBe("Same name as John J. Oros");
  });

  it("flags repeats within the file by email or name", () => {
    const { rows: out } = previewRoster([row(), row({ row: 2, name: "Patricia Example" }), row({ row: 3, email: "other@example.com" })], [], []);
    expect(out.map((r) => r.status)).toEqual(["new", "repeat", "repeat"]);
    expect(out[1].detail).toBe("Repeats row 1 of this file");
  });

  it("never treats someone who asked to be removed as new, by name or email", () => {
    const hash = createHash("sha256").update("pat@example.com").digest("hex");
    expect(previewRoster([row()], [], [{ fullName: "Pat Example", emailSha256: null }]).rows[0].status).toBe("removed");
    expect(previewRoster([row({ name: "P. Renamed", email: "PAT@example.com" })], [], [{ fullName: "Someone Else", emailSha256: hash }]).rows[0].status).toBe("removed");
  });

  it("puts removal ahead of a directory match", () => {
    expect(previewRoster([row({ name: "John Oros" })], directory, [{ fullName: "John Oros", emailSha256: null }]).rows[0].status).toBe("removed");
  });

  it("reports missing and unusable fields, and totals them", () => {
    const preview = previewRoster([row({ email: "", classYear: "20", title: "", employer: "", city: "" }), row({ row: 2, name: "A Person", email: "not-an-email" })], [], []);
    expect(preview.rows[0].missing).toEqual(["Email", "Valid class year", "Role", "City"]);
    expect(preview.rows[1].missing).toEqual(["Valid email"]);
    expect(preview.missing).toEqual({ Email: 1, "Valid class year": 1, Role: 1, City: 1, "Valid email": 1 });
  });

  it("counts rows by status and source, and rejects a row with no name", () => {
    const preview = previewRoster([row({ name: "" }), row({ row: 2, source: "Chapter list" })], [], []);
    expect(preview.counts).toMatchObject({ invalid: 1, new: 1 });
    expect(preview.sources).toEqual({ "WSB roster": 1, "Chapter list": 1 });
  });
});
