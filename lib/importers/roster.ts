// Previews an institution-authorized roster before anything is imported: what
// each row would add, who is probably already in the directory, who asked to be
// removed, and what's missing. Pure functions only; this writes nothing.
import { createHash } from "node:crypto";
import { parseCsv } from "@/lib/linkedin-export";

export const MAX_ROSTER_ROWS = 5000;

export interface RosterRow {
  /** Position among the file's data rows, from 1 (blank rows aren't counted). */
  row: number;
  name: string;
  email: string;
  classYear: string;
  title: string;
  employer: string;
  city: string;
  state: string;
  linkedin: string;
  source: string;
}

export type RosterParse = { ok: true; rows: RosterRow[]; ignoredColumns: string[] } | { ok: false; message: string };

const COLUMN_NAMES: Record<string, keyof RosterRow | "first" | "last"> = {
  name: "name",
  "full name": "name",
  "first name": "first",
  "last name": "last",
  email: "email",
  "email address": "email",
  "e-mail": "email",
  "class year": "classYear",
  "grad year": "classYear",
  "graduation year": "classYear",
  title: "title",
  "job title": "title",
  position: "title",
  employer: "employer",
  company: "employer",
  organization: "employer",
  city: "city",
  state: "state",
  linkedin: "linkedin",
  "linkedin url": "linkedin",
  source: "source",
};

export function parseRoster(text: string, defaultSource: string): RosterParse {
  const [header, ...lines] = parseCsv(text.replace(/^﻿/, ""));
  if (!header) return { ok: false, message: "That file is empty." };

  const columns = header.map((h) => COLUMN_NAMES[h.trim().toLowerCase().replace(/[_\s]+/g, " ")]);
  if (!columns.includes("name") && !(columns.includes("first") && columns.includes("last"))) {
    return { ok: false, message: "The first row needs a “Name” column, or “First name” and “Last name” columns." };
  }
  if (lines.length > MAX_ROSTER_ROWS) return { ok: false, message: `That file has ${lines.length} rows. Preview up to ${MAX_ROSTER_ROWS} at a time.` };

  const rows: RosterRow[] = [];
  lines.forEach((cells, i) => {
    const read: Partial<Record<keyof RosterRow | "first" | "last", string>> = {};
    columns.forEach((column, c) => {
      if (column) read[column] = (cells[c] ?? "").trim();
    });
    rows.push({
      row: i + 1,
      name: read.name || [read.first, read.last].filter(Boolean).join(" "),
      email: read.email ?? "",
      classYear: read.classYear ?? "",
      title: read.title ?? "",
      employer: read.employer ?? "",
      city: read.city ?? "",
      state: read.state ?? "",
      linkedin: read.linkedin ?? "",
      source: read.source || defaultSource,
    });
  });
  return { ok: true, rows, ignoredColumns: header.filter((h, i) => h.trim() && !columns[i]).map((h) => h.trim()) };
}

const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "phd", "md", "jd", "mba", "cfa", "cpa"]);

/** "John J. Oros, Jr." and "john oros" → "john oros". Middle names and suffixes vary between sources. */
export function nameKey(name: string): string {
  const parts = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.,'’"]/g, "")
    .split(/\s+/)
    .filter((part) => part && !NAME_SUFFIXES.has(part));
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]}` : (parts[0] ?? "");
}

const linkedinKey = (url: string) => url.toLowerCase().match(/linkedin\.com\/in\/([^/?#\s]+)/)?.[1] ?? "";
const emailHash = (email: string) => createHash("sha256").update(email.toLowerCase()).digest("hex");

export interface DirectoryPerson {
  id: string;
  fullName: string;
  emails: string[];
  linkedins: string[];
}

export interface Suppression {
  fullName: string;
  emailSha256: string | null;
}

/** In the order a row is checked: the first that applies wins. */
export type RosterStatus = "invalid" | "removed" | "repeat" | "duplicate" | "new";

export interface RosterPreviewRow {
  row: number;
  name: string;
  email: string;
  source: string;
  status: RosterStatus;
  /** Why it isn't simply new. */
  detail: string | null;
  matchId: string | null;
  missing: string[];
}

export interface RosterPreview {
  rows: RosterPreviewRow[];
  counts: Record<RosterStatus, number>;
  missing: Record<string, number>;
  sources: Record<string, number>;
}

function missingFrom(row: RosterRow): string[] {
  const out: string[] = [];
  if (!row.email) out.push("Email");
  else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email)) out.push("Valid email");
  const year = Number(row.classYear);
  if (!row.classYear) out.push("Class year");
  else if (!Number.isInteger(year) || year < 1930 || year > new Date().getFullYear() + 6) out.push("Valid class year");
  if (!row.title && !row.employer) out.push("Role");
  if (!row.city) out.push("City");
  return out;
}

export function previewRoster(rows: RosterRow[], directory: DirectoryPerson[], suppressions: Suppression[]): RosterPreview {
  const byEmail = new Map<string, DirectoryPerson>();
  const byLinkedin = new Map<string, DirectoryPerson>();
  const byName = new Map<string, DirectoryPerson>();
  for (const person of directory) {
    for (const email of person.emails) byEmail.set(email.toLowerCase(), person);
    for (const url of person.linkedins) if (linkedinKey(url)) byLinkedin.set(linkedinKey(url), person);
    byName.set(nameKey(person.fullName), person);
  }
  const removedEmails = new Set(suppressions.flatMap((s) => (s.emailSha256 ? [s.emailSha256] : [])));
  const removedNames = new Set(suppressions.map((s) => nameKey(s.fullName)));
  const seen = new Map<string, number>();

  const preview = rows.map((row): RosterPreviewRow => {
    const key = nameKey(row.name);
    const base = { row: row.row, name: row.name, email: row.email, source: row.source, missing: missingFrom(row), matchId: null };
    if (!key) return { ...base, status: "invalid", detail: "No name on this row" };
    if ((row.email && removedEmails.has(emailHash(row.email))) || removedNames.has(key)) {
      return { ...base, status: "removed", detail: "Asked to be removed; must not be imported" };
    }
    const firstRow = seen.get(row.email.toLowerCase() || key) ?? seen.get(key);
    seen.set(key, firstRow ?? row.row);
    if (row.email) seen.set(row.email.toLowerCase(), firstRow ?? row.row);
    if (firstRow) return { ...base, status: "repeat", detail: `Repeats row ${firstRow} of this file` };

    const email = byEmail.get(row.email.toLowerCase());
    const linkedin = byLinkedin.get(linkedinKey(row.linkedin));
    const name = byName.get(key);
    const match = email ?? linkedin ?? name;
    if (!match) return { ...base, status: "new", detail: null };
    const how = email ? "Same email as" : linkedin ? "Same LinkedIn as" : "Same name as";
    return { ...base, status: "duplicate", detail: `${how} ${match.fullName}`, matchId: match.id };
  });

  const counts: RosterPreview["counts"] = { invalid: 0, removed: 0, repeat: 0, duplicate: 0, new: 0 };
  const missing: Record<string, number> = {};
  const sources: Record<string, number> = {};
  for (const row of preview) {
    counts[row.status] += 1;
    sources[row.source] = (sources[row.source] ?? 0) + 1;
    for (const field of row.missing) missing[field] = (missing[field] ?? 0) + 1;
  }
  return { rows: preview, counts, missing, sources };
}
