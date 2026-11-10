// Where contact details come from, in the order the pipeline tries them:
//   a. free public listings (company pages, registries, LinkedIn snippets,
//      people-search sites), read through the self-hosted SearXNG search;
//   b. free tiers of licensed APIs, each behind an env key;
//   c. paid providers: the interface and stub adapters only, no spend.
// Members adding their own details (d) is the app's job, not this file's.
//
// A source only reports values that are written in what it read. Bot checks,
// logins and CAPTCHAs are never worked around: a blocked page is skipped.
import { attribute, emailDomain, extractCandidates, formatUsPhone, normalizeUsPhone } from "./extract";
import { hunterVerdict } from "./validate";
import type { ContactSource, FindingSource, PersonRef, RawFinding, SearchHit, SourceContext } from "./types";

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};
const onAny = (url: string, domains: string[]) => domains.some((d) => host(url) === d || host(url).endsWith(`.${d}`));

export const LINKEDIN_HOSTS = ["linkedin.com"];
export const PEOPLE_SEARCH_HOSTS = ["spokeo.com", "whitepages.com", "beenverified.com", "truepeoplesearch.com", "fastpeoplesearch.com", "radaris.com", "intelius.com", "peoplefinders.com"];
export const REGISTRY_HOSTS = ["wisbar.org", "licensesearch.wi.gov", "dsps.wi.gov", "brokercheck.finra.org", "adviserinfo.sec.gov", "sec.gov", "wisc.edu"];
// Contact-data vendors' teaser pages show masked or licensed values: use their APIs, not their pages.
const VENDOR_HOSTS = ["rocketreach.co", "zoominfo.com", "contactout.com", "signalhire.com", "apollo.io", "lusha.com", "datanyze.com", "hunter.io", "clay.com", "peopledatalabs.com"];
const SOCIAL_HOSTS = ["facebook.com", "twitter.com", "x.com", "instagram.com", "tiktok.com", "youtube.com", "pinterest.com"];

interface PageOptions {
  source: FindingSource;
  /** Lower every confidence to at most this (sources where namesakes are common). */
  cap?: number;
  forceLabel?: RawFinding["label"];
  /** Must the text also name the person's city? */
  requireCity?: boolean;
}

/** Values in one text (a result snippet or a fetched page) that look like this person's. */
export function findingsInText(person: PersonRef, text: string, url: string, options: PageOptions): RawFinding[] {
  if (options.requireCity && (!person.city || !text.toLowerCase().includes(person.city.toLowerCase()))) return [];
  const out: RawFinding[] = [];
  for (const candidate of extractCandidates(text)) {
    const attribution = attribute(person, text, candidate);
    if (!attribution) continue;
    out.push({
      kind: candidate.kind,
      value: candidate.value,
      label: options.forceLabel ?? attribution.label,
      source: options.source,
      sourceDetail: host(url),
      sourceUrl: url,
      quote: candidate.quote,
      confidence: Math.min(attribution.confidence, options.cap ?? 1),
      patternGuessed: false,
      pageText: text,
    });
  }
  return out;
}

/** Reads each hit's snippet and, when `readPages` allows, the page behind it. */
async function fromHits(person: PersonRef, hits: SearchHit[], ctx: SourceContext, options: PageOptions & { readPages: boolean }): Promise<RawFinding[]> {
  const out: RawFinding[] = [];
  for (const hit of hits) {
    const snippet = `${hit.title}\n${hit.snippet}`;
    out.push(...findingsInText(person, snippet, hit.url, options));
    // Only download pages whose snippet already names the person.
    if (!options.readPages || !snippet.toLowerCase().includes(person.lastName.toLowerCase())) continue;
    const page = await ctx.fetchPage(hit.url);
    if (page) out.push(...findingsInText(person, page, hit.url, options));
  }
  return out;
}

const quoted = (person: PersonRef) => `"${person.fullName}"`;
const always = () => ({ enabled: true });

/** Company team and leadership pages, press releases, faculty pages: the employer's own listings first. */
export const companyPages: ContactSource = {
  id: "company-pages",
  label: "Company and public web pages",
  tier: "free",
  status: always,
  async find(person, ctx) {
    const skip = [...LINKEDIN_HOSTS, ...PEOPLE_SEARCH_HOSTS, ...VENDOR_HOSTS, ...SOCIAL_HOSTS];
    const queries: { query: string; includeDomains?: string[] }[] = [];
    if (person.orgDomain) queries.push({ query: quoted(person), includeDomains: [person.orgDomain] });
    if (person.organizationName) queries.push({ query: `${quoted(person)} "${person.organizationName}" email OR phone OR contact` });
    const out: RawFinding[] = [];
    for (const q of queries) {
      const hits = (await ctx.search(q.query, { maxResults: 5, includeDomains: q.includeDomains })).filter((h) => !onAny(h.url, skip));
      out.push(...(await fromHits(person, hits, ctx, { source: "web", readPages: true })));
    }
    return out;
  },
};

/** Bar directories, Wisconsin DSPS, FINRA BrokerCheck, SEC filings and university pages. */
export const registries: ContactSource = {
  id: "registries",
  label: "Professional registries and university pages",
  tier: "free",
  status: always,
  async find(person, ctx) {
    const hits = await ctx.search(quoted(person), { maxResults: 6, includeDomains: REGISTRY_HOSTS });
    return fromHits(person, hits.filter((h) => onAny(h.url, REGISTRY_HOSTS)), ctx, { source: "registry", readPages: true });
  },
};

const HEALTH = /\b(m\.?d\.?|d\.?o\.?|physician|surgeon|doctor|dentist|d\.?d\.?s\.?|nurse|pharmacist|therapist|psychologist|optometrist|chiropractor|clinic|medical)\b/i;

interface NpiResult {
  number?: string | number;
  basic?: { first_name?: string; last_name?: string };
  addresses?: { address_purpose?: string; city?: string; state?: string; telephone_number?: string }[];
}

/**
 * NPI Registry (CMS's public API): a provider's practice-location phone. Only
 * asked for people in health care, and only kept when exactly one provider has
 * this name in this state.
 */
export const npiRegistry: ContactSource = {
  id: "npi",
  label: "NPI Registry (practice phone)",
  tier: "free",
  status: always,
  async find(person, ctx) {
    const inHealth = HEALTH.test(person.title ?? "") || /health|medic|pharma|biotech/.test(person.industrySlug ?? "");
    if (!inHealth || !person.state) return [];
    const url = `https://npiregistry.cms.hhs.gov/api/?version=2.1&first_name=${encodeURIComponent(person.firstName)}&last_name=${encodeURIComponent(person.lastName)}&state=${person.state}&limit=10`;
    const body = (await ctx.fetchJson(url)) as { results?: NpiResult[] };
    const same = (a?: string, b?: string | null) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
    const matches = (body.results ?? []).filter((r) => same(r.basic?.first_name, person.firstName) && same(r.basic?.last_name, person.lastName));
    if (matches.length !== 1) {
      if (matches.length > 1) ctx.note(`NPI Registry: ${matches.length} providers share this name in ${person.state}; skipped`);
      return [];
    }
    const practice = matches[0].addresses?.find((a) => a.address_purpose === "LOCATION" && a.telephone_number);
    const value = practice?.telephone_number ? normalizeUsPhone(practice.telephone_number) : null;
    if (!practice || !value) return [];
    return [
      {
        kind: "phone",
        value,
        label: "work",
        source: "registry",
        sourceDetail: "npi",
        sourceUrl: url,
        quote: `NPI ${matches[0].number ?? ""} practice location, ${practice.city ?? ""} ${practice.state ?? ""}: telephone_number ${practice.telephone_number}`.replace(/\s+/g, " "),
        // The city is the check that this is the same person, not a namesake.
        confidence: same(practice.city, person.city) ? 0.85 : 0.6,
        patternGuessed: false,
        pageText: null,
      },
    ];
  },
};

/**
 * LinkedIn, as far as a free reader gets: the public search snippet. Profile
 * pages sit behind a sign-in wall, which isn't worked around; reading them
 * takes a scraping vendor (see linkedInVendor).
 */
export const linkedInSnippets: ContactSource = {
  id: "linkedin",
  label: "LinkedIn (public search snippets)",
  tier: "free",
  status: always,
  async find(person, ctx) {
    const hits = await ctx.search(`${quoted(person)} ${person.organizationName ?? ""}`.trim(), { maxResults: 3, includeDomains: ["linkedin.com"] });
    return fromHits(person, hits.filter((h) => /linkedin\.com\/in\//.test(h.url)), ctx, { source: "linkedin", readPages: false });
  },
};

/**
 * People-search sites. Their details are personal, and namesakes are the norm,
 * so a value needs the person's city beside it, is capped at low confidence,
 * and always waits for an administrator. Home addresses are never read.
 */
export const peopleSearch: ContactSource = {
  id: "people-search",
  label: "People-search sites (Spokeo, Whitepages, BeenVerified…)",
  tier: "free",
  status: always,
  async find(person, ctx) {
    if (!person.city || !person.state) return [];
    const hits = await ctx.search(`${quoted(person)} ${person.city} ${person.state}`, { maxResults: 6, includeDomains: PEOPLE_SEARCH_HOSTS });
    // The listing itself must be this person's: on someone else's page ("Maura
    // McCann … relatives: Declan Emmett McCann") a matching name is a relative or namesake.
    const theirs = (h: SearchHit) => new RegExp(`\\b${person.firstName}[\\s_+-]+${person.lastName}\\b`, "i").test(`${decodeURIComponent(new URL(h.url).pathname)} ${h.title}`);
    return fromHits(person, hits.filter((h) => onAny(h.url, PEOPLE_SEARCH_HOSTS) && theirs(h)), ctx, {
      source: "people_search",
      readPages: true,
      cap: 0.5,
      forceLabel: "personal",
      requireCity: true,
    });
  },
};

/**
 * FEC contribution records (OpenFEC). They hold employer, occupation and city
 * but no email or phone, so this only reports whether the record agrees with
 * the profile. Nothing from it is stored.
 */
export const fecRecords: ContactSource = {
  id: "fec",
  label: "FEC donor records (employer and city check only)",
  tier: "keyed",
  status: (env) => (env.FEC_API_KEY ? { enabled: true } : { enabled: false, reason: "FEC_API_KEY not set (free key from api.data.gov)" }),
  async find(person, ctx) {
    if (!person.state) return [];
    const url = `https://api.open.fec.gov/v1/schedules/schedule_a/?contributor_name=${encodeURIComponent(`${person.lastName}, ${person.firstName}`)}&contributor_state=${person.state}&per_page=20&sort=-contribution_receipt_date&api_key=${encodeURIComponent(ctx.env.FEC_API_KEY ?? "")}`;
    const body = (await ctx.fetchJson(url)) as { results?: { contributor_employer?: string; contributor_city?: string }[] };
    const org = (person.organizationName ?? "").toLowerCase().split(/[^a-z0-9]+/).find((w) => w.length >= 4);
    const agree = (body.results ?? []).filter((r) => org && (r.contributor_employer ?? "").toLowerCase().includes(org));
    if (agree.length) ctx.note(`FEC: ${agree.length} contribution record(s) list the same employer (${agree[0].contributor_city ?? "city not given"})`);
    return [];
  },
};

interface HunterFinder {
  data?: { email?: string | null; score?: number; sources?: { uri?: string }[]; verification?: { status?: string } | null };
}

/**
 * Hunter.io email finder (free tier). When Hunter cites public pages for the
 * address it was found on the web; with no pages cited it was built from the
 * company's pattern, which only counts once a verifier confirms it.
 */
export const hunter: ContactSource = {
  id: "hunter",
  label: "Hunter.io email finder",
  tier: "keyed",
  status: (env) => (env.HUNTER_API_KEY ? { enabled: true } : { enabled: false, reason: "HUNTER_API_KEY not set" }),
  async find(person, ctx) {
    if (!person.orgDomain && !person.organizationName) return [];
    // Hunter resolves a company name to its domain when we don't know it.
    const employer = person.orgDomain ? `domain=${encodeURIComponent(person.orgDomain)}` : `company=${encodeURIComponent(person.organizationName!)}`;
    const base = `https://api.hunter.io/v2/email-finder?${employer}&first_name=${encodeURIComponent(person.firstName)}&last_name=${encodeURIComponent(person.lastName)}`;
    const body = (await ctx.fetchJson(`${base}&api_key=${encodeURIComponent(ctx.env.HUNTER_API_KEY ?? "")}`)) as HunterFinder;
    const email = body.data?.email?.toLowerCase();
    if (!email) return [];
    // Hunter sometimes cites a search-engine query rather than a page that shows
    // the address. That isn't a page anyone can read the address on, so it
    // counts as pattern-built.
    const pages = (body.data?.sources ?? [])
      .map((s) => s.uri)
      .filter((uri): uri is string => Boolean(uri) && !/^https?:\/\/(www\.)?(google|bing|duckduckgo|yahoo)\.[a-z.]+\/search/i.test(uri ?? ""));
    const verdict = body.data?.verification?.status ? hunterVerdict({ status: body.data.verification.status }) : null;
    return [
      {
        kind: "email",
        value: email,
        label: "work",
        source: "hunter",
        sourceDetail: pages.length ? "hunter-found" : "hunter-pattern",
        // The key is never kept in a stored URL.
        sourceUrl: pages[0] ?? base,
        quote: pages.length
          ? `Hunter email-finder: ${email}, seen on ${pages.length} public page(s), score ${body.data?.score ?? "n/a"}`
          : `Hunter email-finder: ${email}, built from the ${emailDomain(email)} address pattern, score ${body.data?.score ?? "n/a"}`,
        confidence: Math.min(0.95, (body.data?.score ?? 50) / 100),
        patternGuessed: pages.length === 0,
        pageText: null,
        ...(verdict ? { verification: { ...verdict, method: "hunter", checked_at: new Date().toISOString() } } : {}),
      },
    ];
  },
};

/** A paid provider that is wired into the waterfall but not implemented or enabled. */
function paidStub(id: string, label: string, envKey: string): ContactSource {
  return {
    id,
    label,
    tier: "paid",
    status: (env) => ({
      enabled: false,
      reason: env[envKey] ? `${envKey} is set, but this adapter is a stub: paid lookups need your go-ahead first` : `paid provider (stub); needs ${envKey}`,
    }),
    async find() {
      throw new Error(`${label} is a stub adapter. See the cost table in docs/ARCHITECTURE.md §3c before enabling it.`);
    },
  };
}

export const peopleDataLabs = paidStub("pdl", "People Data Labs person enrichment", "PDL_API_KEY");
export const apollo = paidStub("apollo", "Apollo.io people match", "APOLLO_API_KEY");
export const clay = paidStub("clay", "Clay waterfall enrichment", "CLAY_API_KEY");
export const linkedInVendor = paidStub("linkedin-vendor", "LinkedIn profile vendor (Bright Data, Apify, Coresignal)", "LINKEDIN_VENDOR_API_KEY");

/** The waterfall, in the order sources are tried. */
export const CONTACT_SOURCES: ContactSource[] = [
  companyPages,
  registries,
  npiRegistry,
  linkedInSnippets,
  peopleSearch,
  fecRecords,
  hunter,
  peopleDataLabs,
  apollo,
  clay,
  linkedInVendor,
];

export { formatUsPhone };
