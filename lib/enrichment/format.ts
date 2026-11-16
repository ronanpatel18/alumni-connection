// How facts read from the web are written before they're saved or shown, so a
// profile says "BS, Computer Science" and "Lead Director", not "bachelor of
// science in computer science" and "lead director". Pure functions.

const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "in", "nor", "of", "on", "or", "the", "to", "with", "per", "via"]);
// Kept in capitals wherever they appear.
const ACRONYMS = new Set([
  "CEO", "CFO", "COO", "CIO", "CTO", "CMO", "CRO", "CHRO", "CPO", "CAO", "CLO", "CDO", "VP", "SVP", "EVP", "AVP", "GM", "MD", "HR", "IT", "PR", "UX", "UI", "AI", "ML", "QA",
  "M&A", "R&D", "ESG", "IPO", "LLC", "LLP", "LP", "PLC", "USA", "US", "UK", "EU", "EMEA", "APAC", "NYC", "CPA", "CFA", "MBA", "BBA", "JD", "PHD", "ERP", "CRM", "SaaS", "B2B", "B2C", "II", "III", "IV",
]);
const ACRONYM_SPELLING = new Map([...ACRONYMS].map((a) => [a.toUpperCase(), a]));
ACRONYM_SPELLING.set("PHD", "PhD");

function capitalizeWord(word: string): string {
  // "o'brien-smith" → "O'Brien-Smith"; "mcdonald" is left as "Mcdonald" (can't know).
  return word.replace(/(^|[-'’/])(\p{L})/gu, (_, lead: string, letter: string) => lead + letter.toUpperCase());
}

/**
 * Title case for a short label. Words someone already capitalized on purpose
 * ("iOS", "McKinsey", "eBay") are left alone; only all-lowercase or
 * ALL-CAPITALS words are changed.
 */
export function titleCase(text: string): string {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  return words
    .map((word, i) => {
      const bare = word.replace(/[.,;:()]/g, "");
      const acronym = ACRONYM_SPELLING.get(bare.toUpperCase());
      if (acronym) return word.replace(bare, acronym);
      const lower = word.toLowerCase();
      // "Director Of Sales": a small word capitalized mid-title is a typing habit, not a choice.
      if (i > 0 && i < words.length - 1 && SMALL_WORDS.has(lower) && word === capitalizeWord(lower)) return lower;
      const mixed = word !== lower && word !== word.toUpperCase();
      if (mixed) return word;
      // Short all-capitals words someone typed are probably acronyms ("IBM"), unless the whole text shouts.
      if (word === word.toUpperCase() && bare.length <= 4 && /^[A-Z&]+$/.test(bare) && text !== text.toUpperCase()) return word;
      if (i > 0 && i < words.length - 1 && SMALL_WORDS.has(lower)) return lower;
      return capitalizeWord(lower);
    })
    .join(" ");
}

/** A phrase, not a sentence: short, and without the punctuation or verbs of running prose. */
function isLabel(text: string, maxWords: number, maxChars: number): boolean {
  if (!text || text.length > maxChars || text.split(" ").length > maxWords) return false;
  if (/[.!?;]\s|\n/.test(text)) return false;
  return !/\b(is|are|was|were|has|have|had|who|which|where|when|while|that|he|she|they|his|her|their)\b/i.test(text);
}

const DEGREES: [RegExp, string][] = [
  [/^(executive (mba|master of business administration)|emba)$/i, "EMBA"],
  [/^(master'?s? (of|in) business administration|m\.?b\.?a\.?)$/i, "MBA"],
  [/^(bachelor'?s? (of|in) business administration|b\.?b\.?a\.?)$/i, "BBA"],
  [/^(master'?s? (of|in) accountancy|master'?s? (of|in) accounting|m\.?acc\.?)$/i, "MAcc"],
  [/^(bachelor'?s? (of|in) science|b\.?s\.?c?\.?)$/i, "BS"],
  [/^(bachelor'?s? (of|in) arts|b\.?a\.?|a\.?b\.?)$/i, "BA"],
  [/^(master'?s? (of|in) science|m\.?s\.?c?\.?)$/i, "MS"],
  [/^(master'?s? (of|in) arts|m\.?a\.?)$/i, "MA"],
  [/^(juris doctor(ate)?|doctor of law|j\.?d\.?)$/i, "JD"],
  [/^(doctor of philosophy|doctorate|ph\.?d\.?)$/i, "PhD"],
  [/^(doctor of medicine|m\.?d\.?)$/i, "MD"],
  [/^(master'?s? (of|in) public (administration|affairs)|m\.?p\.?a\.?)$/i, "MPA"],
  [/^(master'?s? (of|in) fine arts|m\.?f\.?a\.?)$/i, "MFA"],
  [/^(bachelor'?s? (of|in) fine arts|b\.?f\.?a\.?)$/i, "BFA"],
  [/^(master'?s? (of|in) engineering|m\.?eng\.?)$/i, "MEng"],
  [/^(bachelor'?s? (of|in) science (of|in) engineering|b\.?s\.?e\.?)$/i, "BSE"],
  [/^(master'?s? (of|in) education|m\.?ed\.?)$/i, "MEd"],
  [/^(doctor of pharmacy|pharm\.?d\.?)$/i, "PharmD"],
  [/^(doctor of veterinary medicine|d\.?v\.?m\.?)$/i, "DVM"],
  [/^(master'?s? (of|in) social work|m\.?s\.?w\.?)$/i, "MSW"],
  [/^bachelor'?s?$/i, "Bachelor’s"],
  [/^master'?s?$/i, "Master’s"],
];

/**
 * A degree and major as the directory writes them: the degree's short form,
 * and the major in title case. "bachelor of science in computer science" →
 * { degree: "BS", major: "Computer Science" }.
 */
export function formatEducation(degree: string | null, major: string | null): { degree: string | null; major: string | null } {
  let d = degree?.replace(/\s+/g, " ").trim().replace(/\s+degree$/i, "").replace(/^an?\s+/i, "") || null;
  let m = major?.replace(/\s+/g, " ").trim() || null;
  // "BS in Computer Science", "Bachelor of Science, Finance", "BBA (Finance)": the major is inside the degree.
  if (d) {
    // "Bachelor of Business Administration (BBA)": the short form is given.
    const short = d.match(/^(.+?)\s*\(([A-Za-z.]{2,6})\)$/);
    if (short && DEGREES.some(([re]) => re.test(short[2]))) d = short[2];
    const split = d.match(/^(.+?)(?:\s+(?:in|with a (?:major|concentration) in)\s+|\s*,\s*|\s*\(\s*)(.+?)\)?$/i);
    if (split && DEGREES.some(([re]) => re.test(split[1].trim()))) {
      d = split[1].trim();
      m ??= split[2].trim();
    }
    d = DEGREES.find(([re]) => re.test(d!))?.[1] ?? (d.length <= 40 ? d : null);
  }
  if (m) {
    m = m.replace(/^(a\s+)?(major|degree|concentration|emphasis)\s+in\s+/i, "").replace(/\s+(major|degree)$/i, "").replace(/[.,;]+$/, "");
    // The "major" a source gives is sometimes just the degree again ("BBA, Business Administration"),
    // or a placeholder where it found none.
    const repeatsDegree = DEGREES.some(([re]) => re.test(m!)) || (d && m.toLowerCase() === d.toLowerCase()) || (/^(BBA|MBA|EMBA)$/.test(d ?? "") && /^business( administration)?$/i.test(m));
    if (repeatsDegree || /^(not (stated|specified|given|listed|available|known)|n\/?a|none|unknown|unspecified|general)$/i.test(m)) m = null;
    else m = isLabel(m, 8, 80) ? titleCase(m) : null;
  }
  return { degree: d, major: m };
}

/** A job title: "lead director" → "Lead Director", "ceo and co-founder" → "CEO and Co-Founder". Null if it reads as a sentence. */
export function formatJobTitle(title: string): string | null {
  // "Senior Vice President- Payments" → "Senior Vice President - Payments".
  const t = title.replace(/\s+/g, " ").trim().replace(/^(the|a|an)\s+/i, "").replace(/[.,;:]+$/, "").replace(/(\p{L})- (?=\p{L})/gu, "$1 - ");
  return isLabel(t, 12, 120) ? titleCase(t) : null;
}

/** An employer's name with stray punctuation removed; its own capitals are kept. */
export function formatOrganization(name: string): string | null {
  const n = name.replace(/\s+/g, " ").trim().replace(/^the\s+(?=[A-Z])/, "The ").replace(/[.,;:]+$/, (end) => (/(Inc|Co|Corp|Ltd|L\.P|LLC)\.?$/i.test(name.trim()) && end === "." ? "." : ""));
  if (!n || n.length > 120 || /[.!?]\s/.test(n.replace(/\b(Inc|Co|Corp|Ltd|St|Dr|Mr|Ms|Jr|Sr)\.\s/g, ""))) return null;
  return n === n.toLowerCase() || n === n.toUpperCase() ? (n.length <= 4 ? n.toUpperCase() : titleCase(n)) : n;
}

/** Focus areas: one to four words each, title case, no sentences, no repeats. */
export function formatSpecialties(specialties: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of specialties) {
    const s = raw.replace(/\s+/g, " ").trim().replace(/[.,;:]+$/, "");
    if (!isLabel(s, 4, 40) || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(titleCase(s));
  }
  return out.slice(0, 4);
}

/** "new york" → "New York". Null for anything that isn't a place name ("Headquartered in Mountain View", "Jane Doe - Chicago"). */
export function formatCity(city: string): string | null {
  const c = city.replace(/\s+/g, " ").trim().replace(/[.,;]+$/, "");
  if (!/^\p{L}[\p{L}.'’ -]{1,39}$/u.test(c) || c.split(" ").length > 4 || / - /.test(c)) return null;
  if (/\b(headquartered|based|located|area|greater|metro(politan)?|region|office|remote|united states|usa)\b/i.test(c)) return null;
  // Regions people name instead of a city.
  if (/^(silicon valley|bay area|the bay|twin cities|tri-state|new england|midwest|east coast|west coast|southern california|northern california)$/i.test(c)) return null;
  return titleCase(c);
}
