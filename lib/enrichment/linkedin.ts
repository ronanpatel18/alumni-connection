// Reads a LinkedIn profile's public search snippet (the preview a search
// engine shows; LinkedIn itself is never fetched). Snippets look like:
//   ## Experience - Partner at PwC (Jul 2019 to present) - Director at PwC (Jul 2017 to Jun 2019) …
//   ## Education - University of Wisconsin-Madison, Bachelor of Business Administration (BBA), Accounting - …
//   Location: Minneapolis, Minnesota, United States
// Snippets are cut off with "[...]", so entries may be missing; nothing here is guessed.

export interface LinkedInPosition {
  title: string;
  organization: string;
  /** YYYY-MM-01 */
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
}

export interface LinkedInEducation {
  school: string;
  /** Degree and field as written ("Bachelor of Business Administration (BBA), Accounting"). */
  details: string | null;
}

export interface LinkedInLocation {
  city: string;
  /** Two-letter code, when the snippet names a US state. */
  state: string | null;
  /** True for "Greater Chicago Area"-style metro areas (the city is the metro's main city). */
  isMetroArea: boolean;
}

export interface LinkedInSnippet {
  location: LinkedInLocation | null;
  experience: LinkedInPosition[];
  education: LinkedInEducation[];
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

export const US_STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT",
  delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI",
  minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC",
  "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
};

// LinkedIn's metro-area names → the main city (and its state).
const METRO_AREAS: [RegExp, string, string][] = [
  [/new york city metropolitan/i, "New York", "NY"],
  [/minneapolis[-–]st\.? paul/i, "Minneapolis", "MN"],
  [/washington dc[-–]baltimore/i, "Washington", "DC"],
  [/dallas[-–]fort worth/i, "Dallas", "TX"],
  [/san francisco bay/i, "San Francisco", "CA"],
  [/los angeles metropolitan/i, "Los Angeles", "CA"],
  [/greater chicago/i, "Chicago", "IL"],
  [/greater milwaukee/i, "Milwaukee", "WI"],
  [/greater seattle/i, "Seattle", "WA"],
  [/greater boston/i, "Boston", "MA"],
  [/greater madison/i, "Madison", "WI"],
  [/greater philadelphia/i, "Philadelphia", "PA"],
  [/greater houston/i, "Houston", "TX"],
  [/atlanta metropolitan/i, "Atlanta", "GA"],
  [/denver metropolitan/i, "Denver", "CO"],
];

function toDate(raw: string): string | null {
  const m = raw.trim().match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{4})$/);
  if (m && MONTHS[m[1].toLowerCase()]) return `${m[2]}-${MONTHS[m[1].toLowerCase()]}-01`;
  const y = raw.trim().match(/^(\d{4})$/);
  return y ? `${y[1]}-01-01` : null;
}

/** The text of one "## Heading" section, up to the next heading or a "[...]" cut. */
function section(content: string, heading: string): string | null {
  const start = content.indexOf(`## ${heading}`);
  if (start < 0) return null;
  const rest = content.slice(start + heading.length + 3);
  const end = rest.search(/##\s|\[\.\.\.\]|\bLocation:/);
  return (end >= 0 ? rest.slice(0, end) : rest).trim();
}

/** "- a - b - c" list items. Item text never starts with "- " mid-line, but may contain " - " (e.g. "Consumer Offer Manager - bp pulse"). */
function items(body: string): string[] {
  const parts = body
    .split(/(?:^|\s)-\s(?=[A-Z0-9])/)
    .map((s) => s.trim())
    .filter(Boolean);
  // "University of Wisconsin-Madison - School of Business, BBA" is one entry.
  const joined: string[] = [];
  for (const part of parts) {
    if (joined.length && /^(School|College|Graduate School|Law School) of\b/.test(part)) joined[joined.length - 1] += ` - ${part}`;
    else joined.push(part);
  }
  return joined;
}

/** Google/Bing-style snippet: "Partner. PwC. Jul 2019 - Present 7 years 4 months. … · Director. PwC. Jul 2017 - Jun 2019". */
function parseExperienceShort(content: string): LinkedInPosition[] {
  const positions: LinkedInPosition[] = [];
  for (const m of content.matchAll(/(?:^|[·.]\s+)([A-Z][^.·]{1,100}?)\.\s+([^.·]{1,80}?)\.\s+([A-Z][a-z]{2}\s+\d{4}|\d{4})\s+-\s+(Present|[A-Z][a-z]{2}\s+\d{4}|\d{4})/g)) {
    const isCurrent = m[4].toLowerCase() === "present";
    positions.push({ title: m[1].trim(), organization: m[2].trim(), startDate: toDate(m[3]), endDate: isCurrent ? null : toDate(m[4]), isCurrent });
  }
  return positions;
}

export function parseExperience(content: string): LinkedInPosition[] {
  const body = section(content, "Experience");
  if (!body) return parseExperienceShort(content);
  const positions: LinkedInPosition[] = [];
  // "Title at Company (Mon YYYY to present)": the dates anchor each entry, so
  // titles containing " - " don't split it.
  for (const m of body.matchAll(/(?:^|\s-\s)(.+?)\s+at\s+(.+?)\s+\(([A-Za-z]{3,9}\.?\s+\d{4}|\d{4})\s+to\s+(present|[A-Za-z]{3,9}\.?\s+\d{4}|\d{4})\)/g)) {
    const title = m[1].replace(/^-\s*/, "").trim();
    const organization = m[2].trim();
    if (!title || !organization || title.length > 150 || organization.length > 120) continue;
    const isCurrent = m[4].toLowerCase() === "present";
    positions.push({ title, organization, startDate: toDate(m[3]), endDate: isCurrent ? null : toDate(m[4]), isCurrent });
  }
  return positions;
}

export function parseEducation(content: string): LinkedInEducation[] {
  const body = section(content, "Education");
  if (!body) return [];
  return items(body).map((item) => {
    const comma = item.indexOf(",");
    return comma > 0 ? { school: item.slice(0, comma).trim(), details: item.slice(comma + 1).trim() || null } : { school: item, details: null };
  });
}

export function parseLocation(content: string): LinkedInLocation | null {
  const m =
    content.match(/Location:\s*([^\n#[]+?)(?:\s*(?:\n|##|\[|$))/) ??
    // Google/Bing snippets: "… · Minneapolis, Minnesota, United States · …"
    content.match(/(?:^|[·.]\s+)((?:Greater\s+)?[A-Z][\w .'-]{1,40},\s*[A-Z][a-z]+(?:\s[A-Z][a-z]+)?,\s*United States)/);
  if (!m) return null;
  const raw = m[1].replace(/\s+United States$/, "").replace(/,\s*United States$/, "").trim();
  for (const [re, city, state] of METRO_AREAS) if (re.test(raw)) return { city, state, isMetroArea: true };
  const greater = raw.match(/^Greater\s+(.+?)(?:\s+Area)?$/i);
  if (greater) return { city: greater[1].trim(), state: null, isMetroArea: true };
  const parts = raw.split(",").map((p) => p.trim());
  if (parts.length >= 2) {
    const state = US_STATES[parts[1].toLowerCase()];
    // Outside the US ("London, England, United Kingdom"): keep the city, no state.
    return { city: parts[0], state: state ?? null, isMetroArea: false };
  }
  return null;
}

export function parseLinkedInSnippet(content: string): LinkedInSnippet {
  return { location: parseLocation(content), experience: parseExperience(content), education: parseEducation(content) };
}

/** "University of Wisconsin-Madison", "Wisconsin School of Business"; not other UW campuses. */
export function isUwMadison(school: string): boolean {
  if (/eau claire|milwaukee|la crosse|oshkosh|green bay|parkside|platteville|river falls|stevens point|stout|superior|whitewater|extension/i.test(school)) {
    return false;
  }
  return /university of wisconsin[\s–—-]*madison|wisconsin school of business|uw[\s–—-]*madison/i.test(school);
}

/** "Bachelor of Business Administration (BBA), Accounting" → { degree: "BBA", major: "Accounting" }. */
export function degreeFromDetails(details: string | null): { degree: string | null; major: string | null } {
  if (!details) return { degree: null, major: null };
  const abbr = details.match(/\((BBA|MBA|BS|BA|MS|MA|JD|PhD|MAcc|EMBA)\)/i)?.[1];
  const long: [RegExp, string][] = [
    [/master of business administration/i, "MBA"],
    [/bachelor'?s? of business administration/i, "BBA"],
    [/master of accountancy/i, "MAcc"],
    [/bachelor of science/i, "BS"],
    [/bachelor of arts/i, "BA"],
    [/master of science/i, "MS"],
    [/juris doctor/i, "JD"],
    [/^\s*(BBA|MBA|BS|BA|MS|MA|JD|PhD)\b/i, "$1"],
  ];
  let degree: string | null = abbr ? abbr.toUpperCase().replace("PHD", "PhD").replace("MACC", "MAcc") : null;
  if (!degree) {
    for (const [re, label] of long) {
      const m = details.match(re);
      if (m) {
        degree = label === "$1" ? m[1].toUpperCase() : label;
        break;
      }
    }
  }
  const afterComma = details.includes(",") ? details.slice(details.indexOf(",") + 1).trim() : null;
  return { degree, major: afterComma && afterComma.length < 120 ? afterComma : null };
}
