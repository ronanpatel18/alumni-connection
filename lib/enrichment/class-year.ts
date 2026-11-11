// Finds UW–Madison class years stated in text (bios, search snippets) with
// plain patterns, no AI: every finding carries the exact words it came from.
// Only explicit statements count; a year is never estimated from a career.
import { degreeIsFromOtherCampus } from "./verify";

export interface ClassYearFinding {
  year: number;
  degree: string | null;
  /** The sentence or line the year was read from. */
  quote: string;
  /** "stated": the text says it outright. "range": a LinkedIn-style "1993 – 1997" span (end year). */
  kind: "stated" | "range";
}

const DEGREE = String.raw`(B\.?B\.?A|M\.?B\.?A|B\.?S\.?E|B\.?S|B\.?A|M\.?S|M\.?A|J\.?D|Ph\.?D|M\.?Acc|MAcc|M\.?D|EMBA)\.?`;
// A year in these sentences isn't the person's own degree year.
const NOT_THEIR_DEGREE = [
  /\bhonorary\b/i, // honorary degrees aren't alumni status
  /\b(wife|husband|spouse|son|daughter|father|mother|brother|sister|children|parents?|grand\w+)\b/i, // a relative's degree
  // Someone speaking to a graduating class isn't in it ("as a commencement speaker… with the class of 2012").
  /\bcommencement (speaker|address|speech)\b/i,
  /\b(to|with|address\w*|told|tells|welcom\w+|congratulat\w+) the class of\b/i,
];

const UW = /\b(university of wisconsin|uw[-–—\s]*madison|wisconsin[-–—\s]*madison|wisconsin school of business|\buw\b|badger)/i;

// Between the UW mention and "in 1991": no other clause ("and in 1957 he earned an MBA from Stanford").
const SAME_CLAUSE = String.raw`(?:(?!\band\b)[^.;,\n]){0,60}?`;

const PATTERNS: { re: RegExp; kind: ClassYearFinding["kind"]; needsUw: boolean; degreeFirst?: boolean }[] = [
  // "BBA 1951", "MBA ’97", "B.B.A. '85", "BBA, 1991", "Sean Jacobsohn (BBA '94)"
  { re: new RegExp(String.raw`\b${DEGREE},?\s*['’]?(\d{4}|\d{2})\b(?![-–—]\s*\d)`, "gi"), kind: "stated", needsUw: true, degreeFirst: true },
  // "class of 1998", "Class of ’98"
  { re: /\bclass of\s*['’]?(\d{4}|\d{2})\b/gi, kind: "stated", needsUw: true },
  // "graduated from the University of Wisconsin-Madison in 1991", "earned his BBA from UW–Madison in 1985"
  {
    re: new RegExp(String.raw`\b(?:graduat\w*|earned|received|completed)\b[^.;\n]{0,90}?(?:university of wisconsin|uw)${SAME_CLAUSE}\bin\s+(\d{4})\b`, "gi"),
    kind: "stated",
    needsUw: false,
  },
  // "In 1955, he graduated from the University of Wisconsin–Madison"
  {
    re: /\b[Ii]n\s+(\d{4}),?\s+(?:he|she|they|[A-Z][a-z]+)\s+(?:graduated|earned|received)[^.;\n]{0,60}?(?:[Uu]niversity of [Ww]isconsin|UW)/g,
    kind: "stated",
    needsUw: false,
  },
  // LinkedIn snippet: "University of Wisconsin-Madison · BBA, Finance · 1993 - 1997"
  { re: /(?:university of wisconsin|wisconsin)[-–—\s]*madison[^0-9\n]{0,80}?(\d{4})\s*[-–—]\s*(\d{4})\b/gi, kind: "range", needsUw: false },
];

// Spelled-out degrees ("his Master of Science degree in real estate").
const LONG_DEGREES: [RegExp, string][] = [
  [/\bmaster of business administration\b/i, "MBA"],
  [/\bbachelor of business administration\b/i, "BBA"],
  [/\bmaster of science\b/i, "MS"],
  [/\bmaster of arts\b/i, "MA"],
  [/\bmaster'?s degree\b/i, "MS"],
  [/\bbachelor of science\b/i, "BS"],
  [/\bbachelor of arts\b/i, "BA"],
  [/\bjuris doctor|law degree\b/i, "JD"],
  [/\bdoctorate|ph\.?d\b/i, "PhD"],
];

/** The degree named in the matched phrase (or just after it: "in 1991 with a BBA"). */
function degreeNear(window: string): string | null {
  const short = window.match(new RegExp(String.raw`\b${DEGREE}(?=[\s,)]|$)`, "i"))?.[1];
  if (short) return normalizeDegreeLabel(short);
  return LONG_DEGREES.find(([re]) => re.test(window))?.[1] ?? null;
}

function expandYear(raw: string, currentYear: number): number {
  if (raw.length === 4) return Number(raw);
  const two = Number(raw);
  return two <= currentYear % 100 ? 2000 + two : 1900 + two;
}

function normalizeDegreeLabel(raw: string | undefined): string | null {
  if (!raw) return null;
  const compact = raw.replace(/\./g, "").toUpperCase();
  return compact === "MACC" ? "MAcc" : compact === "PHD" ? "PhD" : compact;
}

/** Sentences or lines: line breaks matter on profile pages ("BBA 1951, JD 1953\nFounder…"). */
function segments(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface AboutPerson {
  fullName: string;
  /** The page is about them (their bio, an article with their name in the title), so "He graduated…" is about them. */
  pageIsAboutThem: boolean;
}

const NAME_SUFFIX = /^(jr|sr|ii|iii|iv)\.?$/i;

function nameParts(fullName: string) {
  const words = fullName
    .split(/\s+/)
    .map((w) => w.replace(/[,]/g, ""))
    .filter((w) => w && !NAME_SUFFIX.test(w) && !/^[A-Z]\.$/.test(w));
  return { first: words[0] ?? "", last: words[words.length - 1] ?? "" };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * @param uwContext true when the whole text is about UW–Madison already (the
 *   person's page on a UW–Madison site), so "BBA 1951" needs no "Wisconsin" nearby.
 * @param about the person the text should be about. Pages often name several
 *   alumni ("Jane Roe (BBA '01) and John Doe (MBA '95)"), so a year counts only
 *   if it's attached to this person's name, or sits in a sentence about them.
 */
export function findClassYears(
  text: string,
  { uwContext = false, currentYear = new Date().getFullYear(), about }: { uwContext?: boolean; currentYear?: number; about?: AboutPerson } = {},
): ClassYearFinding[] {
  const found: ClassYearFinding[] = [];
  const name = about ? nameParts(about.fullName) : null;
  const nameRe = name ? new RegExp(String.raw`\b(${escapeRe(name.first)}|${escapeRe(name.last)})\b`, "i") : null;
  const fullNameRe = name ? new RegExp(String.raw`\b${escapeRe(name.first)}\b[\s\w.]{0,20}?\b${escapeRe(name.last)}\b`, "i") : null;
  const add = (f: ClassYearFinding) => {
    if (f.year < 1930 || f.year > currentYear) return;
    if (!found.some((x) => x.year === f.year && x.degree === f.degree)) found.push(f);
  };
  const quoteOf = (segment: string) => (segment.length > 300 ? `${segment.slice(0, 297)}…` : segment);

  for (const segment of segments(text)) {
    if (NOT_THEIR_DEGREE.some((re) => re.test(segment))) continue;
    // Name lists (commencement programs, donor rolls) run on for hundreds of
    // words without a sentence break; a real sentence about one person doesn't.
    if (segment.length > 600) continue;
    // "John and Anne Oros (BBA '71 and B.A. '72 respectively)": can't tell whose is whose.
    if (/\brespectively\b/i.test(segment)) continue;
    // On a page about someone else, a bare surname may be a relative ("Hammes earned…"
    // on Jon Hammes's page is not Patrick Hammes), so their full name must appear.
    const mentionsPerson = !name || (about!.pageIsAboutThem ? nameRe!.test(segment) : fullNameRe!.test(segment));
    if (about && !mentionsPerson && !about.pageIsAboutThem) continue;
    const mentionsUw = UW.test(segment);

    // UW's own alumni notation right after the name: "John Oros ’71".
    if (name && mentionsUw) {
      for (const m of segment.matchAll(new RegExp(String.raw`\b${escapeRe(name.last)}\s*\(?['’](\d{2})\b(?!['’]?s\b)`, "gi"))) {
        add({ year: expandYear(m[1], currentYear), degree: null, kind: "stated", quote: quoteOf(segment) });
      }
    }

    for (const { re, kind, needsUw, degreeFirst } of PATTERNS) {
      if (needsUw && !mentionsUw && !uwContext) continue;
      for (const match of segment.matchAll(re)) {
        const groups = match.slice(1).filter((g) => g !== undefined);
        const at = match.index ?? 0;
        let degree: string | null = null;
        let year: number;
        if (kind === "range") {
          const start = Number(groups[0]);
          year = Number(groups[1]);
          if (year < start || year - start > 8) continue;
        } else if (degreeFirst) {
          // "Name (BBA '94)": whose name comes right before the degree?
          if (name) {
            const before = segment.slice(Math.max(0, at - 40), at).replace(/[\s,(]+$/, "");
            const prevWords = before.match(/([A-Z][\w’'.-]*)\s+([A-Z][\w’'-]+)$/);
            const prev = before.match(/([A-Z][\w’'-]+)$/)?.[1];
            let isThem = Boolean(prev && [name.first, name.last].some((n) => n.toLowerCase() === prev.toLowerCase()));
            // "Anne Oros (BA ’72)": the right surname with someone else's first name is a relative.
            if (isThem && prev!.toLowerCase() === name.last.toLowerCase() && prevWords) {
              const firstBefore = prevWords[1].replace(/\.$/, "");
              const ownNames = about!.fullName.toLowerCase().split(/\s+/).map((w) => w.replace(/\.$/, ""));
              if (firstBefore.length > 1 && !ownNames.includes(firstBefore.toLowerCase())) isThem = false;
            }
            if (prev && /^[A-Z][a-z]/.test(prev) && !isThem && !/^(BBA|MBA|BA|BS|MS|JD|PhD)$/i.test(prev)) continue; // someone else's degree
            if (!isThem && !about!.pageIsAboutThem) continue;
          }
          degree = normalizeDegreeLabel(groups[0]);
          year = expandYear(groups[1], currentYear);
        } else {
          year = expandYear(groups[groups.length - 1], currentYear);
          // Look a little past the match ("in 1991 with a BBA"), but not into the next clause.
          const after = segment.slice(at + match[0].length, at + match[0].length + 40).split(/,|;|\band\b/)[0];
          degree = degreeNear(match[0] + after);
        }
        // "an MBA from UW–Milwaukee in 2001" is not a Madison degree.
        if (degreeIsFromOtherCampus(segment, degree)) continue;
        add({ year, degree, kind, quote: quoteOf(segment) });
      }
    }
  }
  return found;
}

/**
 * Picks one year per degree. Conflicting years for the same degree are dropped
 * (better no year than a wrong one); outright statements beat date ranges.
 */
export function chooseClassYears(findings: ClassYearFinding[]): ClassYearFinding[] {
  const byDegree = new Map<string, ClassYearFinding[]>();
  for (const f of findings) {
    const key = f.degree ?? "?";
    byDegree.set(key, [...(byDegree.get(key) ?? []), f]);
  }
  const chosen: ClassYearFinding[] = [];
  for (const [key, list] of byDegree) {
    const stated = list.filter((f) => f.kind === "stated");
    const pool = stated.length ? stated : list;
    const years = new Set(pool.map((f) => f.year));
    if (years.size !== 1) continue;
    // An undated-degree finding adds nothing when a named degree has the same year.
    if (key === "?" && chosen.some((c) => c.year === pool[0].year)) continue;
    chosen.push(pool[0]);
  }
  return chosen.filter((c) => c.degree !== null || !chosen.some((o) => o.degree !== null && o.year === c.year));
}
