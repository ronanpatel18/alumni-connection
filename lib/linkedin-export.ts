// Reads a member's own LinkedIn data export (Settings → Data privacy → "Get a
// copy of your data"), either the ZIP or its CSV files. This is the sanctioned
// way to bring LinkedIn data in: the member downloads and uploads their own
// archive. Nothing here fetches LinkedIn. Only these three files are read.
import { unzipSync, strFromU8 } from "fflate";
import { isUwMadison } from "@/lib/enrichment/linkedin";

export interface ExportPosition {
  title: string;
  company: string;
  startDate: string | null; // YYYY-MM-01
  endDate: string | null;
}

export interface ExportEducation {
  school: string;
  degree: string | null;
  startYear: number | null;
  endYear: number | null;
}

export interface ExportConnection {
  firstName: string;
  lastName: string;
  url: string | null;
  company: string | null;
  position: string | null;
}

export interface LinkedInExport {
  positions: ExportPosition[];
  educations: ExportEducation[];
  connections: ExportConnection[];
  /** Files found, for the preview ("Positions.csv, Education.csv"). */
  files: string[];
}

/** RFC 4180 CSV: quoted fields, doubled quotes, newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}

/** Rows as objects keyed by header. LinkedIn puts a "Notes:" preamble above Connections' header. */
function records(text: string, firstHeader: string): Record<string, string>[] {
  const rows = parseCsv(text);
  const headerAt = rows.findIndex((r) => r[0]?.trim().toLowerCase() === firstHeader.toLowerCase());
  if (headerAt < 0) return [];
  const header = rows[headerAt].map((h) => h.trim());
  return rows.slice(headerAt + 1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** "Jan 2015", "2015", "01/2015" → "2015-01-01". */
export function exportDate(raw: string): string | null {
  const v = raw.trim();
  const named = v.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{4})$/);
  if (named && MONTHS[named[1].toLowerCase()]) return `${named[2]}-${MONTHS[named[1].toLowerCase()]}-01`;
  const numeric = v.match(/^(\d{1,2})\/(\d{4})$/);
  if (numeric) return `${numeric[2]}-${numeric[1].padStart(2, "0")}-01`;
  const year = v.match(/^(\d{4})$/);
  return year ? `${year[1]}-01-01` : null;
}

const yearOf = (raw: string) => {
  const d = exportDate(raw) ?? raw.match(/\b(19|20)\d{2}\b/)?.[0];
  return d ? Number(String(d).slice(0, 4)) : null;
};

export function parsePositions(text: string): ExportPosition[] {
  return records(text, "Company Name")
    .filter((r) => r["Company Name"] && r["Title"])
    .map((r) => ({ title: r["Title"], company: r["Company Name"], startDate: exportDate(r["Started On"] ?? ""), endDate: exportDate(r["Finished On"] ?? "") }));
}

export function parseEducation(text: string): ExportEducation[] {
  return records(text, "School Name")
    .filter((r) => r["School Name"])
    .map((r) => ({ school: r["School Name"], degree: r["Degree Name"] || null, startYear: yearOf(r["Start Date"] ?? ""), endYear: yearOf(r["End Date"] ?? "") }));
}

export function parseConnections(text: string): ExportConnection[] {
  return records(text, "First Name")
    .filter((r) => r["First Name"] || r["Last Name"])
    .map((r) => ({
      firstName: r["First Name"],
      lastName: r["Last Name"],
      url: r["URL"] || null,
      company: r["Company"] || null,
      position: r["Position"] || null,
    }));
}

const MAX_BYTES = 25 * 1024 * 1024;
const WANTED = { positions: /(^|\/)positions\.csv$/i, education: /(^|\/)education\.csv$/i, connections: /(^|\/)connections\.csv$/i };

/** Reads a ZIP export or individual CSVs. Throws a readable error for anything else. */
export function readLinkedInExport(files: { name: string; bytes: Uint8Array }[]): LinkedInExport {
  const texts: Partial<Record<keyof typeof WANTED, string>> = {};
  const found: string[] = [];
  const take = (name: string, text: string) => {
    for (const [key, re] of Object.entries(WANTED) as [keyof typeof WANTED, RegExp][]) {
      if (re.test(name) && !texts[key]) {
        texts[key] = text;
        found.push(name.split("/").pop()!);
      }
    }
  };
  for (const file of files) {
    if (file.bytes.byteLength > MAX_BYTES) throw new Error("That file is larger than 25 MB. Upload the Basic export ZIP, or just its CSV files.");
    if (/\.zip$/i.test(file.name)) {
      let entries: Record<string, Uint8Array>;
      try {
        // Only the three CSVs are decompressed; photos and messages in the archive are skipped.
        entries = unzipSync(file.bytes, { filter: (f) => Object.values(WANTED).some((re) => re.test(f.name)) && f.originalSize < MAX_BYTES });
      } catch {
        throw new Error("That ZIP couldn’t be opened. Download the export again from LinkedIn and upload it as is.");
      }
      for (const [name, bytes] of Object.entries(entries)) take(name, strFromU8(bytes));
    } else if (/\.csv$/i.test(file.name)) {
      take(file.name, strFromU8(file.bytes));
    }
  }
  if (!found.length) throw new Error("No Positions.csv, Education.csv or Connections.csv found. Upload the ZIP LinkedIn emailed you, or those CSV files.");
  return {
    positions: texts.positions ? parsePositions(texts.positions) : [],
    educations: texts.education ? parseEducation(texts.education) : [],
    connections: texts.connections ? parseConnections(texts.connections) : [],
    files: found,
  };
}

/** UW–Madison entries from the education list. */
export const uwEducations = (educations: ExportEducation[]) => educations.filter((e) => isUwMadison(e.school));
