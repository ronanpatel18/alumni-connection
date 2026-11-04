// Normalizes the Wisconsin School of Business advisory-board snapshot
// (data/sources/wsb-advisory-boards-*.json) into rows for the directory.
// Pure functions only, so they're unit-tested; scripts/import-wsb-boards.ts writes them.
import { z } from "zod";

export const SOURCE = "wsb-advisory-boards";
export const PARENT_UNIT = "Wisconsin School of Business";

export const snapshotSchema = z.object({
  source: z.url(),
  retrievedAt: z.string(),
  members: z.array(
    z.object({
      name: z.string().min(1),
      board: z.string(),
      boards: z.array(z.string()),
      position: z.string().nullable(),
      organization: z.string().nullable(),
      photoUrl: z.url().nullable(),
      profileUrl: z.url().nullable(),
      bio: z.string().nullable(),
    }),
  ),
});
export type BoardSnapshot = z.infer<typeof snapshotSchema>;
export type BoardMember = BoardSnapshot["members"][number];

export type Seniority = "entry" | "mid" | "senior" | "manager" | "director" | "vp" | "c_suite" | "partner" | "owner";

export interface NormalizedMember {
  externalId: string;
  externalUrl: string;
  fullName: string;
  firstName: string;
  lastName: string;
  title: string | null;
  organizationName: string | null;
  seniority: Seniority | null;
  headline: string | null;
  bio: string | null;
  photoUrl: string | null;
  groups: { slug: string; name: string }[];
  /** Board membership alone tells us this much about UW–Madison alumni status. */
  alumniStatus: "likely" | "unknown";
}

const NAME_SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "phd", "cfa", "cpa"]);
const NOT_AN_ORGANIZATION = new Set(["self-employed", "self employed", "in memoriam"]);

export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/["'’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** "WSB External Advisory Board" → { slug: "wsb-external-advisory-board", ... } */
export function groupFor(boardName: string): { slug: string; name: string } {
  const name = boardName.trim();
  const slug = slugify(/^wsb\b/i.test(name) || /wisconsin/i.test(name) ? name : `wsb ${name}`);
  return { slug, name };
}

export function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.replace(/\s+/g, " ").trim().split(" ");
  const core = parts.filter((p, i) => i === 0 || !NAME_SUFFIXES.has(p.toLowerCase()));
  // Skip a leading initial ("H. Signe Ostby" → Signe).
  const first = /^[A-Z]\.$/.test(core[0]) && core.length > 2 ? core[1] : core[0];
  return { firstName: first, lastName: core.length > 1 ? core[core.length - 1] : "" };
}

export function seniorityFor(title: string | null): Seniority | null {
  if (!title) return null;
  const t = title.toLowerCase();
  if (/\b(founder|co-founder|owner)\b/.test(t)) return "owner";
  if (/\b(ceo|cfo|coo|cio|cto|cmo|chief|president|chair(man|woman)?)\b/.test(t) && !/vice president/.test(t)) return "c_suite";
  if (/\b(partner|principal|managing director)\b/.test(t)) return "partner";
  if (/\b(vp|svp|evp|vice president|general manager|gvp)\b/.test(t)) return "vp";
  if (/\b(director|head of|lead)\b/.test(t)) return "director";
  if (/\b(manager|controller)\b/.test(t)) return "manager";
  if (/\b(senior|sr\.?)\b/.test(t)) return "senior";
  if (/\b(analyst|associate|consultant|buyer)\b/.test(t)) return "mid";
  return null;
}

function externalIdFor(member: BoardMember): string {
  const slug = member.profileUrl?.match(/\/board-member\/profile\/([^/]+)\/?$/)?.[1];
  return slug ?? `alumni-board/${slugify(member.name)}`;
}

export function normalizeMember(member: BoardMember, snapshotSource: string): NormalizedMember {
  const organization =
    member.organization && !NOT_AN_ORGANIZATION.has(member.organization.trim().toLowerCase())
      ? member.organization.trim()
      : null;
  const title = member.position?.trim() || null;
  const boardNames = [...new Set([member.board, ...member.boards].map((b) => b.replace(/^External Advisory Board$/, "WSB External Advisory Board").replace(/^Wisconsin Naming Partners$/, "Wisconsin Naming Partners Advisory Board")))];
  const { firstName, lastName } = splitName(member.name);

  return {
    externalId: externalIdFor(member),
    externalUrl: member.profileUrl ?? `${snapshotSource}#alumni`,
    fullName: member.name.replace(/\s+/g, " ").trim(),
    firstName,
    lastName,
    title,
    organizationName: organization,
    seniority: seniorityFor(title),
    headline: title && organization ? `${title} at ${organization}` : (title ?? organization),
    bio: member.bio?.trim() || null,
    photoUrl: member.photoUrl,
    groups: boardNames.map(groupFor),
    alumniStatus: member.board === "Wisconsin Business Alumni Board" ? "likely" : "unknown",
  };
}

export function normalizeSnapshot(snapshot: BoardSnapshot): NormalizedMember[] {
  return snapshot.members
    .filter((m) => m.organization?.trim().toLowerCase() !== "in memoriam")
    .map((m) => normalizeMember(m, snapshot.source));
}

export interface SuppressionRow {
  full_name: string;
  source: string | null;
  external_id: string | null;
}

/**
 * True if this member asked to be removed. A record with a source ID matches only
 * that exact listing (so a different person with the same name isn't blocked);
 * name-only records (e.g. from an emailed request) match by name.
 */
export function isSuppressed(member: Pick<NormalizedMember, "externalId" | "fullName">, rows: SuppressionRow[]): boolean {
  const name = member.fullName.trim().toLowerCase();
  return rows.some((row) =>
    row.source && row.external_id
      ? row.source === SOURCE && row.external_id === member.externalId
      : row.full_name.trim().toLowerCase() === name,
  );
}
