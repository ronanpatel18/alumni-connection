// Picks an employer's own web domain out of search results. Used to fill
// organizations.domain, which the contact pipeline needs: a wrong domain would
// send a lookup to a namesake at another company, so only a domain that is
// plainly the organization's name is accepted. Anything less is left blank.

export interface DomainHit {
  url: string;
  title: string;
}

export interface DomainChoice {
  domain: string;
  website: string;
  /** Why it was accepted, for the dry-run report. */
  reason: string;
}

// Sites that write about companies rather than being one.
const NOT_A_COMPANY_SITE = new Set([
  "linkedin.com", "facebook.com", "twitter.com", "x.com", "instagram.com", "youtube.com", "tiktok.com",
  "wikipedia.org", "wikidata.org", "bloomberg.com", "crunchbase.com", "pitchbook.com", "zoominfo.com", "rocketreach.co",
  "dnb.com", "glassdoor.com", "indeed.com", "yelp.com", "bbb.org", "opencorporates.com", "sec.gov", "finra.org",
  "forbes.com", "reuters.com", "wsj.com", "nytimes.com", "businesswire.com", "prnewswire.com", "globenewswire.com",
  "google.com/maps", "mapquest.com", "yahoo.com", "apple.com/maps", "wisc.edu", "github.com", "medium.com", "signalhire.com",
  "apollo.io", "owler.com", "craft.co", "cbinsights.com", "theorg.com", "builtin.com", "comparably.com", "datanyze.com",
]);

const LEGAL_WORDS = new Set(["inc", "llc", "llp", "lp", "ltd", "plc", "co", "corp", "corporation", "company", "incorporated", "limited", "the", "and", "of", "pc", "pllc", "sc", "na"]);
// Dropped from the end of a name when comparing ("Lubar & Co." → lubar, "Hammes Company" → hammes).
const GENERIC_TAIL = new Set(["group", "partners", "capital", "management", "mgmt", "holdings", "international", "global", "services", "associates", "advisors", "consulting", "ventures", "enterprises", "solutions", "investments", "development"]);
/** Country sites are skipped: they are rarely where a US employee gets mail. */
const GENERIC_TLD = /\.(com|org|net|edu|io|co|ai|us|gov)$/;
const TWO_PART_TLDS = /\.(co|com|org|net|ac|gov)\.[a-z]{2}$/;

/** "www.careers.tishmanspeyer.com" → "tishmanspeyer.com". */
export function registrableDomain(hostname: string): string {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  const parts = host.split(".");
  const keep = TWO_PART_TLDS.test(host) ? 3 : 2;
  return parts.slice(-keep).join(".");
}

/** The name's own words, lowercased, without legal suffixes: "Lubar & Co., Inc." → ["lubar"]. */
export function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !LEGAL_WORDS.has(w));
}

/**
 * The first result whose domain is the organization's name: all its words run
 * together ("tishmanspeyer.com"), the name without a generic last word
 * ("riverwater" for Riverwater Partners), or a one-word name itself ("google").
 * The page title must name the organization too. Returns null when unsure.
 */
export function pickDomain(orgName: string, hits: DomainHit[]): DomainChoice | null {
  const tokens = nameTokens(orgName);
  if (!tokens.length) return null;
  const core = tokens.length > 1 && GENERIC_TAIL.has(tokens[tokens.length - 1]) ? tokens.slice(0, -1) : tokens;
  const accepted = new Map<string, string>([
    [tokens.join(""), "the domain is the organization's name"],
    [tokens.join("-"), "the domain is the organization's name"],
  ]);
  // A distinctive core only: "first" for First Capital would match anyone.
  if (core.join("").length >= 6 || core.length === tokens.length) {
    if (!accepted.has(core.join(""))) accepted.set(core.join(""), `the domain is the name without “${tokens[tokens.length - 1]}”`);
  }

  const fullKeys = new Set([tokens.join(""), tokens.join("-")]);
  for (const hit of hits) {
    let host: string;
    try {
      host = new URL(hit.url).hostname;
    } catch {
      continue;
    }
    const domain = registrableDomain(host);
    if (NOT_A_COMPANY_SITE.has(domain)) continue;
    const label = domain.split(".")[0];
    const reason = accepted.get(label);
    if (!reason) continue;
    // Guards against a different business that happens to own the same word.
    // A shortened name ("fiduciary" for Fiduciary Management) must be backed by
    // the whole name in the title.
    const title = hit.title.toLowerCase();
    const needed = fullKeys.has(label) ? core : tokens;
    if (!needed.every((word) => title.includes(word)) && !(fullKeys.has(label) && title.replace(/[^a-z0-9]/g, "").includes(label))) continue;
    const choice = { domain, website: `https://${domain}`, reason };
    // A country site (pwc.in) may be the right company but is the wrong mail
    // domain for a US directory: keep looking, and give up rather than use it.
    if (!GENERIC_TLD.test(domain)) continue;
    // A one-word name ("Endeavor", "Protagonist") is shared by unrelated
    // organizations on other endings; only its .com is taken as the company's.
    if (tokens.length === 1 && !domain.endsWith(".com")) continue;
    return choice;
  }
  return null;
}
