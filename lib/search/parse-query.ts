// Rule-based search parser. Handles most queries ("commercial real estate in
// Chicago", "class of 2010 mentors in tech") with no model call at all; the AI
// parser is only needed when nothing here is recognized.
import type { ParsedQuery } from "@/lib/ai/schemas";

export interface SearchVocabulary {
  industries: { slug: string; name: string; synonyms: string[] }[];
  places: { id: number; name: string; state: string; metro: string }[];
}

export interface RuleParseResult {
  query: ParsedQuery;
  placeId: number | null;
  /** True when the text is a long phrase with nothing recognized; worth asking a model. */
  needsModel: boolean;
}

const PLACE_ALIASES: Record<string, string> = {
  nyc: "New York",
  "new york city": "New York",
  manhattan: "New York",
  "bay area": "San Francisco",
  sf: "San Francisco",
  "twin cities": "Minneapolis",
  dc: "Washington",
  "washington dc": "Washington",
  dfw: "Dallas",
  la: "Los Angeles",
  "milwaukee area": "Milwaukee",
};

const OPEN_TO_PATTERNS: [RegExp, ParsedQuery["openTo"][number]][] = [
  [/\bmentor(s|ship|ing)?\b/, "mentoring"],
  [/\bhiring\b/, "hiring"],
  [/\binvest(or|ors|ing)\b/, "investing"],
  [/\b(job seekers?|looking for (a )?job)\b/, "job_seeking"],
  [/\breferrals?\b/, "referrals"],
  [/\bspeakers?\b/, "speaking"],
  [/\bfundrais(ing|e)\b/, "fundraising"],
];

// What can follow "open to". Read before places and industries, because
// "investing" is also a finance synonym. Bare "networking" stays a keyword: it
// is also a field ("cisco networking"), so it only counts after "open to".
const OPEN_TO_PHRASES: [string, ParsedQuery["openTo"][number]][] = [
  ["network(?:ing)?", "networking"],
  ["mentor(?:ing|ship)?", "mentoring"],
  ["hiring", "hiring"],
  ["job seeking", "job_seeking"],
  ["invest(?:ing)?", "investing"],
  ["fundrais(?:ing|e)", "fundraising"],
  ["referrals?", "referrals"],
  ["meeting travell?ers", "meeting_travelers"],
  ["speak(?:ing)?", "speaking"],
];
const OPEN_TO_ITEM = `(?:${OPEN_TO_PHRASES.map(([phrase]) => phrase).join("|")})`;
const OPEN_TO_CLAUSE = new RegExp(`\\bopen to (${OPEN_TO_ITEM}(?: (?:and |or )?${OPEN_TO_ITEM})*)\\b`);

// Career levels, read only from unambiguous plural forms. The words stay in the
// text: "directors of marketing" is still worth matching against titles.
const SENIORITY_PATTERNS: [RegExp, ParsedQuery["seniority"][number]][] = [
  [/\b(executives|c-suite|ceos|cfos|coos)\b/, "c_suite"],
  [/\b(founders|owners|entrepreneurs)\b/, "owner"],
  [/\b(vps|vice presidents)\b/, "vp"],
  [/\bdirectors\b/, "director"],
];

const STOPWORDS = new Set(
  ("show me find who are is the a an in near around at of for with and or people person working work works worked " +
    "folks professionals someone anyone looking to meet connect i my want need any all from based live living " +
    "located area city grads graduates graduate alumni alum alums class uw badgers that do does into on")
    .split(" "),
);

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function twoDigitYear(y: string) {
  const n = Number(y);
  if (y.length === 4) return n;
  return n > 30 ? 1900 + n : 2000 + n;
}

export function parseSearchText(input: string, vocab: SearchVocabulary): RuleParseResult {
  let text = ` ${input.toLowerCase().replace(/[^a-z0-9&'\- ]+/g, " ").replace(/\s+/g, " ").trim()} `;
  const take = (pattern: RegExp) => {
    text = text.replace(pattern, " ");
  };

  const openTo: ParsedQuery["openTo"] = [];
  const openToClause = text.match(OPEN_TO_CLAUSE);
  if (openToClause) {
    for (const [phrase, value] of OPEN_TO_PHRASES) {
      if (new RegExp(`\\b${phrase}\\b`).test(openToClause[1])) openTo.push(value);
    }
    take(OPEN_TO_CLAUSE);
  }

  let radiusMiles: number | null = null;
  const radius = text.match(/\bwithin (\d{1,3}) ?(mi|miles?)\b/);
  if (radius) {
    radiusMiles = Math.min(500, Number(radius[1]));
    take(new RegExp(escapeRegExp(radius[0])));
  }

  let gradYearMin: number | null = null;
  let gradYearMax: number | null = null;
  const range = text.match(/\b(19\d\d|20\d\d) ?(?:-|to) ?(19\d\d|20\d\d)\b/);
  const classOf = text.match(/\bclass of '?(\d{4}|\d{2})\b/) ?? text.match(/ '(\d{2})\b/);
  const decade = text.match(/\b(19\d|20\d)0s\b/);
  const since = text.match(/\b(?:since|after) (19\d\d|20\d\d)\b/);
  const before = text.match(/\bbefore (19\d\d|20\d\d)\b/);
  if (range) {
    gradYearMin = Number(range[1]);
    gradYearMax = Number(range[2]);
    take(new RegExp(escapeRegExp(range[0])));
  } else if (classOf) {
    gradYearMin = gradYearMax = twoDigitYear(classOf[1]);
    take(new RegExp(escapeRegExp(classOf[0])));
  } else if (decade) {
    gradYearMin = Number(`${decade[1]}0`);
    gradYearMax = gradYearMin + 9;
    take(new RegExp(escapeRegExp(decade[0])));
  } else {
    if (since) {
      gradYearMin = Number(since[1]);
      take(new RegExp(escapeRegExp(since[0])));
    }
    if (before) {
      gradYearMax = Number(before[1]) - 1;
      take(new RegExp(escapeRegExp(before[0])));
    }
  }

  // Places: longest names first so "St. Paul" wins over "Paul", aliases included.
  let placeId: number | null = null;
  let city: string | null = null;
  let state: string | null = null;
  const placeTerms: { term: string; place: SearchVocabulary["places"][number] }[] = [];
  for (const place of vocab.places) {
    placeTerms.push({ term: place.name.toLowerCase().replace(/[^a-z0-9 ]/g, ""), place });
    placeTerms.push({ term: place.name.toLowerCase(), place });
  }
  for (const [alias, name] of Object.entries(PLACE_ALIASES)) {
    const place = vocab.places.find((p) => p.name === name);
    if (place) placeTerms.push({ term: alias, place });
  }
  placeTerms.sort((a, b) => b.term.length - a.term.length);
  for (const { term, place } of placeTerms) {
    const pattern = new RegExp(` ${escapeRegExp(term)}(?: ${place.state.toLowerCase()})? `);
    if (pattern.test(text)) {
      placeId = place.id;
      city = place.name;
      state = place.state;
      take(pattern);
      break;
    }
  }

  // Industries: longest phrase first; matched phrases are removed so
  // "commercial real estate" doesn't also count as "real estate".
  const industryTerms = vocab.industries
    .flatMap((industry) => [industry.name, ...industry.synonyms].map((term) => ({ term: term.toLowerCase(), slug: industry.slug })))
    .sort((a, b) => b.term.length - a.term.length);
  const industrySlugs: string[] = [];
  for (const { term, slug } of industryTerms) {
    if (industrySlugs.length >= 3) break;
    const pattern = new RegExp(` ${escapeRegExp(term)} `);
    if (pattern.test(text)) {
      if (!industrySlugs.includes(slug)) industrySlugs.push(slug);
      text = text.replace(pattern, " ");
    }
  }

  for (const [pattern, value] of OPEN_TO_PATTERNS) {
    if (pattern.test(text)) {
      if (!openTo.includes(value)) openTo.push(value);
      take(pattern);
    }
  }

  const seniority = SENIORITY_PATTERNS.filter(([pattern]) => pattern.test(text)).map(([, value]) => value);

  const leftover = text
    .split(" ")
    .map((w) => w.replace(/^[-']+|[-']+$/g, ""))
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
  const recognized = Number(placeId !== null) + industrySlugs.length + openTo.length + Number(gradYearMin !== null || gradYearMax !== null);

  return {
    query: {
      text: leftover.length ? leftover.join(" ") : null,
      industrySlugs,
      city,
      state,
      radiusMiles,
      gradYearMin,
      gradYearMax,
      openTo,
      seniority,
      keywords: leftover.slice(0, 8).map((w) => w.slice(0, 40)),
      goal: null,
    },
    placeId,
    needsModel: recognized === 0 && leftover.length >= 3,
  };
}
