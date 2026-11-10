// A "why this person" line may only restate what the profile says. The prompt
// asks for that; this checks it in code, the way lib/enrichment/verify.ts does
// for enrichment. A line that names a number or a proper noun found neither in
// the person's facts nor in the member's own request is dropped.

const ALWAYS_ALLOWED = new Set(["uw", "madison", "wisconsin", "badger", "badgers", "alumni", "alumnus", "alumna", "ai", "us", "usa"]);

const normalize = (text: string) =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2018\u2019`]/g, "'")
    .replace(/[\u2010-\u2015]/g, "-");

/** True when every number and proper noun in `why` appears in `allowedText`. */
export function isGrounded(why: string, allowedText: string): boolean {
  const allowed = normalize(allowedText);
  const has = (term: string) => allowed.includes(normalize(term));

  for (const number of why.match(/\d[\d,.]*\d|\d{2,}/g) ?? []) {
    if (!has(number) && !has(number.replace(/[,.]/g, ""))) return false;
  }

  // Capitalized words that don't start a sentence are names: employers, places, schools.
  const words = why.split(/\s+/);
  for (let i = 1; i < words.length; i++) {
    if (/[.!?:;]$/.test(words[i - 1])) continue;
    const word = words[i].replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").replace(/['\u2019]s$/, "");
    if (word.length < 2 || !/^\p{Lu}/u.test(word)) continue;
    if (ALWAYS_ALLOWED.has(word.toLowerCase())) continue;
    // "VC-backed", "Austin-based": check each part.
    if (!word.split(/[-/]/).every((part) => part.length < 2 || !/^\p{Lu}/u.test(part) || ALWAYS_ALLOWED.has(part.toLowerCase()) || has(part))) return false;
  }
  return true;
}
