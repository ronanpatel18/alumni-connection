// Web search providers for enrichment. Each one turns a query into the same
// plain result shape, so callers use webSearch() and don't care who answered.
//
// Hosted APIs with a free allowance (a key for each goes in .env.local):
//   keenable  100,000 requests a month           KEENABLE_API_KEY
//   serper    2,500 Google searches on sign-up   SERPER_API_KEY
//   exa       $10 of credit a month              EXA_API_KEY
//   linkup    $20 of credit a month              LINKUP_API_KEY
//   parallel  $5 of credit a month               PARALLEL_API_KEY
// Also: tavily (TAVILY_API_KEY, opt-in) and searxng (self-hosted, keyless;
// npm run search:start), which is what runs when no hosted key is set.
//
// SEARCH_PROVIDER picks: "auto" (default: every hosted provider with a key,
// else SearXNG), or a comma-separated list of names to use only those.
import { fetchPageText } from "./free-sources";

export interface SearchResult {
  title?: string;
  url?: string;
  /** The search snippet or excerpt. */
  content?: string;
  /** The page's full text, when the provider returned it or we fetched it. */
  raw_content?: string | null;
  /** When the page was published (YYYY-MM-DD), where the provider says. */
  published?: string | null;
  /** Which provider returned it. */
  provider?: string;
}

export interface SearchOptions {
  /** Per provider. */
  maxResults: number;
  includeDomains?: string[];
  /** Fetch full page text: true for every result, or a test that picks which results to read. */
  rawContent?: boolean | ((result: { url: string; title?: string; content?: string }) => boolean);
  /**
   * "one" (default): ask one provider, taking turns so each free allowance
   * lasts; a provider that fails passes the query to the next.
   * "all": ask every provider at once and merge what they return. Better
   * coverage for one person; costs a search from each allowance.
   */
  spread?: "one" | "all";
}

export type ProviderName = "keenable" | "serper" | "exa" | "linkup" | "parallel" | "tavily" | "searxng";

interface Provider {
  name: ProviderName;
  label: string;
  /** The environment variable holding its key (none for SearXNG). */
  keyName: string | null;
  configured: () => boolean;
  search: (query: string, options: SearchOptions) => Promise<SearchResult[]>;
}

const TIMEOUT_MS = 25_000;
const env = (name: string) => process.env[name]?.trim() || undefined;

class ProviderError extends Error {
  constructor(
    provider: string,
    readonly status: number,
    detail: string,
  ) {
    super(`${provider} search failed: ${status}${detail ? ` ${detail.slice(0, 200)}` : ""}`);
  }
}

async function postJson<T>(provider: string, url: string, headers: Record<string, string>, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new ProviderError(provider, response.status, await response.text().catch(() => ""));
  return (await response.json()) as T;
}

/** `query site:a.com` or `query (site:a.com OR site:b.com)`, for engines without a domain parameter. */
function withSites(query: string, sites: string[] = []): string {
  if (!sites.length) return query;
  return sites.length === 1 ? `${query} site:${sites[0]}` : `${query} (${sites.map((d) => `site:${d}`).join(" OR ")})`;
}

/** Any date a provider sends ("2026-10-30T00:00:00Z", "Mar 10, 2022") as YYYY-MM-DD; relative ones ("2 weeks ago") are dropped. */
function isoDate(raw: string | null | undefined): string | null {
  const time = raw ? Date.parse(raw) : NaN;
  return Number.isNaN(time) ? null : new Date(time).toISOString().slice(0, 10);
}

const onlyLinkedIn = (options: SearchOptions) => options.includeDomains?.length === 1 && options.includeDomains[0] === "linkedin.com";

// --- Keenable: https://docs.keenable.ai/api-reference/search -----------------
// Its keyless endpoint is free too, but queries there are logged without an
// account, so it's used only when KEENABLE_KEYLESS=1 says that's acceptable.
async function keenable(query: string, options: SearchOptions): Promise<SearchResult[]> {
  const key = env("KEENABLE_API_KEY");
  const body = await postJson<{ results?: { title: string; url: string; snippet?: string; published_at?: string }[] }>(
    "Keenable",
    key ? "https://api.keenable.ai/v1/search" : "https://api.keenable.ai/v1/search/public",
    key ? { "X-API-Key": key } : { "X-Keenable-Title": "Alumni Connect" },
    { query: withSites(query, options.includeDomains), max_results: Math.min(options.maxResults, 50), snippet_max_length: 2000 },
  );
  return (body.results ?? []).map((r) => ({ title: r.title, url: r.url, content: r.snippet ?? "", published: isoDate(r.published_at) }));
}

// --- Serper (Google results): https://serper.dev -----------------------------
async function serper(query: string, options: SearchOptions): Promise<SearchResult[]> {
  const body = await postJson<{ organic?: { title: string; link: string; snippet?: string; date?: string }[] }>(
    "Serper",
    "https://google.serper.dev/search",
    { "X-API-KEY": env("SERPER_API_KEY")! },
    { q: withSites(query, options.includeDomains), num: Math.min(options.maxResults, 10), gl: "us", hl: "en" },
  );
  return (body.organic ?? []).map((r) => ({ title: r.title, url: r.link, content: r.snippet ?? "", published: isoDate(r.date) }));
}

// --- Exa: https://docs.exa.ai/reference/search -------------------------------
// Its "people" index returns a LinkedIn profile's text (roles, schools, years),
// which is where dated work history and class years most often come from.
async function exa(query: string, options: SearchOptions): Promise<SearchResult[]> {
  interface ExaBody {
    results?: { title?: string | null; url: string; text?: string; highlights?: string[]; publishedDate?: string }[];
  }
  const people = onlyLinkedIn(options);
  const wantText = people || Boolean(options.rawContent);
  const request = (category: boolean) =>
    postJson<ExaBody>(
      "Exa",
      "https://api.exa.ai/search",
      { "x-api-key": env("EXA_API_KEY")! },
      {
        // Exa is a semantic index: quotes and OR are noise to it.
        query: query.replace(/[()"]/g, " ").replace(/\bOR\b/g, " ").replace(/\s+/g, " ").trim(),
        type: "auto",
        numResults: Math.min(options.maxResults, 10),
        ...(category ? { category: "people" } : options.includeDomains?.length ? { includeDomains: options.includeDomains } : {}),
        contents: wantText ? { text: { maxCharacters: 8000 } } : { highlights: true },
      },
    );
  let body: ExaBody;
  try {
    body = await request(people);
  } catch (error) {
    // A filter the people index refuses: run it as an ordinary search of linkedin.com.
    if (!people || !(error instanceof ProviderError) || error.status !== 400) throw error;
    body = await request(false);
  }
  return (body.results ?? [])
    .filter((r) => !people || /linkedin\.com/.test(r.url))
    .map((r) => {
      const text = r.text ?? (r.highlights ?? []).join(" … ");
      return { title: r.title ?? "", url: r.url, content: text.slice(0, people ? 8000 : 2000), raw_content: r.text ?? null, published: isoDate(r.publishedDate) };
    });
}

// --- Linkup: https://docs.linkup.so ------------------------------------------
async function linkup(query: string, options: SearchOptions): Promise<SearchResult[]> {
  const body = await postJson<{ results?: { type: string; name: string; url: string; content?: string }[] }>(
    "Linkup",
    "https://api.linkup.so/v1/search",
    { Authorization: `Bearer ${env("LINKUP_API_KEY")}` },
    {
      q: query,
      depth: "standard",
      outputType: "searchResults",
      maxResults: options.maxResults,
      ...(options.includeDomains?.length ? { includeDomains: options.includeDomains } : {}),
    },
  );
  return (body.results ?? [])
    .filter((r) => r.type === "text")
    .map((r) => ({ title: r.name, url: r.url, content: (r.content ?? "").slice(0, 2000), raw_content: (r.content ?? "").length > 2000 ? r.content : null }));
}

// --- Parallel: https://docs.parallel.ai/api-reference/search-beta/search ------
async function parallel(query: string, options: SearchOptions): Promise<SearchResult[]> {
  // It wants a goal in plain words plus short keyword queries, not search operators.
  const plain = query.replace(/[()"]/g, " ").replace(/\bOR\b/g, " ").replace(/\s+/g, " ").trim();
  const body = await postJson<{ results?: { url: string; title?: string | null; excerpts?: string[]; publish_date?: string | null }[] }>(
    "Parallel",
    "https://api.parallel.ai/v1/search",
    { "x-api-key": env("PARALLEL_API_KEY")! },
    {
      objective: `Find pages about this person and what they say about their education, class year, employers and location: ${plain}`,
      search_queries: [plain.split(" ").slice(0, 10).join(" ")],
      mode: "fast",
      advanced_settings: {
        max_results: options.maxResults,
        excerpt_settings: { max_chars_per_result: 3000 },
        ...(options.includeDomains?.length ? { source_policy: { include_domains: options.includeDomains } } : {}),
      },
    },
  );
  return (body.results ?? []).map((r) => ({ title: r.title ?? "", url: r.url, content: (r.excerpts ?? []).join("\n"), published: isoDate(r.publish_date) }));
}

// --- Tavily ------------------------------------------------------------------
async function tavily(query: string, options: SearchOptions): Promise<SearchResult[]> {
  const body = await postJson<{ results?: SearchResult[] }>(
    "Tavily",
    "https://api.tavily.com/search",
    { Authorization: `Bearer ${env("TAVILY_API_KEY")}` },
    {
      query,
      max_results: options.maxResults,
      search_depth: "basic",
      include_answer: false,
      include_raw_content: options.rawContent ? "text" : false,
      ...(options.includeDomains ? { include_domains: options.includeDomains } : {}),
    },
  );
  return body.results ?? [];
}

// --- SearXNG (self-hosted) ---------------------------------------------------
const SEARXNG_URL = () => (process.env.SEARXNG_URL ?? "http://127.0.0.1:8888").replace(/\/$/, "");

// The engines behind SearXNG suspend clients that query fast. Each search goes
// to ONE engine, rotating through several, and each engine keeps its own gap:
// with five engines and a 6s gap, searches run about every 1.2s overall while
// no single engine sees more than one every 6s.
const SEARXNG_GAP_MS = Number(process.env.SEARXNG_GAP_MS ?? 6000);
const SEARXNG_ENGINES = (process.env.SEARXNG_ENGINES ?? "yahoo,bing,brave,google cse,qwant")
  .split(",")
  .map((e) => e.trim())
  .filter(Boolean);
const engineQueue = new Map<string, Promise<unknown>>();
const engineLastAt = new Map<string, number>();
let nextEngine = 0;

function pacedFor<T>(engine: string, run: () => Promise<T>): Promise<T> {
  const next = (engineQueue.get(engine) ?? Promise.resolve()).then(async () => {
    const wait = (engineLastAt.get(engine) ?? 0) + SEARXNG_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    engineLastAt.set(engine, Date.now());
    return run();
  });
  engineQueue.set(engine, next.catch(() => undefined));
  return next;
}

/** The engine whose turn is soonest, so work spreads evenly. */
function pickEngine(skip: Set<string>): string | null {
  const candidates = SEARXNG_ENGINES.filter((e) => !skip.has(e));
  if (!candidates.length) return null;
  const engine = candidates[nextEngine % candidates.length];
  nextEngine++;
  return engine;
}

interface SearxBody {
  results?: { url: string; title?: string; content?: string; engines?: string[] }[];
  unresponsive_engines?: [string, string][];
}

async function searxng(query: string, options: SearchOptions): Promise<SearchResult[]> {
  // SearXNG has no domain filter parameter; the engines understand site:.
  const scoped = withSites(query, options.includeDomains);

  // Try up to three engines: a benched or erroring engine passes the query on.
  let body: SearxBody = {};
  const tried = new Set<string>();
  for (let attempt = 0; attempt < 3; attempt++) {
    const engine = pickEngine(tried);
    if (!engine) break;
    tried.add(engine);
    let response: Response;
    try {
      response = await pacedFor(engine, () =>
        fetch(`${SEARXNG_URL()}/search?format=json&engines=${engine}&q=${encodeURIComponent(scoped)}`, { signal: AbortSignal.timeout(30_000) }),
      );
    } catch {
      throw new Error(`SearXNG isn't running at ${SEARXNG_URL()}. Start it with: npm run search:start`);
    }
    if (!response.ok) continue;
    body = (await response.json()) as SearxBody;
    const failed = (body.unresponsive_engines ?? []).some(([name]) => name === engine);
    // An unknown engine name makes SearXNG quietly use its defaults: treat that as a miss too.
    const otherEngines = (body.results ?? []).some((r) => !r.engines?.includes(engine));
    if (!failed && !otherEngines) break;
    body = {};
  }
  return (body.results ?? []).map((r) => ({ url: r.url, title: r.title, content: r.content ?? "" }));
}

// --- Choosing providers ------------------------------------------------------

const PROVIDERS: Provider[] = [
  { name: "keenable", label: "Keenable", keyName: "KEENABLE_API_KEY", configured: () => Boolean(env("KEENABLE_API_KEY")) || env("KEENABLE_KEYLESS") === "1", search: keenable },
  { name: "serper", label: "Serper", keyName: "SERPER_API_KEY", configured: () => Boolean(env("SERPER_API_KEY")), search: serper },
  { name: "exa", label: "Exa", keyName: "EXA_API_KEY", configured: () => Boolean(env("EXA_API_KEY")), search: exa },
  { name: "linkup", label: "Linkup", keyName: "LINKUP_API_KEY", configured: () => Boolean(env("LINKUP_API_KEY")), search: linkup },
  { name: "parallel", label: "Parallel", keyName: "PARALLEL_API_KEY", configured: () => Boolean(env("PARALLEL_API_KEY")), search: parallel },
  { name: "tavily", label: "Tavily", keyName: "TAVILY_API_KEY", configured: () => Boolean(env("TAVILY_API_KEY")), search: tavily },
  { name: "searxng", label: "SearXNG", keyName: null, configured: () => true, search: searxng },
];
/** What "auto" uses. Tavily's small allowance is spent only when asked for by name. */
const HOSTED: ProviderName[] = ["keenable", "serper", "exa", "linkup", "parallel"];

/** The providers searches go to now, in order. */
function activeProviders(): Provider[] {
  const choice = (env("SEARCH_PROVIDER") ?? "auto").toLowerCase();
  if (choice !== "auto") {
    const names = choice.split(",").map((n) => n.trim());
    return PROVIDERS.filter((p) => names.includes(p.name) && p.configured());
  }
  const hosted = PROVIDERS.filter((p) => HOSTED.includes(p.name) && p.configured());
  return hosted.length ? hosted : PROVIDERS.filter((p) => p.name === "searxng");
}

export interface ProviderStatus {
  name: ProviderName;
  label: string;
  keyName: string | null;
  /** Searches go to it now. */
  active: boolean;
}

/** Every provider and whether it's in use: for the admin page and scripts. */
export function searchProviders(): ProviderStatus[] {
  const active = new Set(activeProviders().map((p) => p.name));
  return PROVIDERS.map((p) => ({ name: p.name, label: p.label, keyName: p.keyName, active: active.has(p.name) }));
}

/** The names searches go to, for log lines ("keenable, exa"). */
export function searchProvider(): string {
  return activeProviders().map((p) => p.name).join(", ") || "none";
}

/** True when at least one provider can be used (SearXNG is checked when first called). */
export function searchConfigured(): boolean {
  return activeProviders().length > 0;
}

// A provider that's out of credit, rejects its key or is rate-limited sits out
// for a while instead of failing every search.
const benchedUntil = new Map<ProviderName, number>();
const BENCH_MS = { quota: 60 * 60_000, rate: 60_000 };
let turn = 0;

function bench(provider: Provider, error: unknown) {
  const status = error instanceof ProviderError ? error.status : 0;
  if (status === 401 || status === 402 || status === 403) benchedUntil.set(provider.name, Date.now() + BENCH_MS.quota);
  else if (status === 429) benchedUntil.set(provider.name, Date.now() + BENCH_MS.rate);
}

const bareUrl = (url: string) => url.toLowerCase().split(/[?#]/)[0].replace(/^https?:\/\/(www\.|[a-z]{2}\.)?/, "").replace(/\/$/, "");

async function searchWith(provider: Provider, query: string, options: SearchOptions): Promise<SearchResult[]> {
  const sites = options.includeDomains ?? [];
  const results = (await provider.search(query, options))
    .filter((r): r is SearchResult & { url: string } => {
      if (!r.url) return false;
      try {
        const host = new URL(r.url).hostname;
        return !sites.length || sites.some((d) => host === d || host.endsWith(`.${d}`));
      } catch {
        return false;
      }
    })
    .slice(0, options.maxResults);
  return results.map((r) => ({ ...r, provider: provider.name }));
}

/** Round-robin by rank; a page several providers found is kept once, with its longest text. */
function merge(lists: SearchResult[][]): SearchResult[] {
  const byUrl = new Map<string, SearchResult>();
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let rank = 0; rank < longest; rank++) {
    for (const list of lists) {
      const r = list[rank];
      if (!r?.url) continue;
      const key = bareUrl(r.url);
      const seen = byUrl.get(key);
      if (!seen) byUrl.set(key, { ...r });
      else {
        if ((r.content ?? "").length > (seen.content ?? "").length) seen.content = r.content;
        if ((r.raw_content ?? "").length > (seen.raw_content ?? "").length) seen.raw_content = r.raw_content;
        seen.title ||= r.title;
        seen.published ??= r.published;
      }
    }
  }
  return [...byUrl.values()];
}

/** One web search. See SearchOptions.spread for how providers are chosen. */
export async function webSearch(query: string, options: SearchOptions): Promise<SearchResult[]> {
  const providers = activeProviders();
  if (!providers.length) throw new Error("No web search is configured. Add a search key to .env.local (see .env.example) or run npm run search:start.");
  const ready = providers.filter((p) => (benchedUntil.get(p.name) ?? 0) < Date.now());
  const pool = ready.length ? ready : providers;

  let results: SearchResult[] = [];
  if (options.spread === "all") {
    const settled = await Promise.allSettled(pool.map((p) => searchWith(p, query, options)));
    settled.forEach((s, i) => s.status === "rejected" && bench(pool[i], s.reason));
    const failures = settled.filter((s) => s.status === "rejected");
    if (failures.length === pool.length) throw failures[0].reason;
    results = merge(settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : [])));
  } else {
    const start = turn++;
    let lastError: unknown = null;
    let answered = false;
    for (let i = 0; i < pool.length && !answered; i++) {
      const provider = pool[(start + i) % pool.length];
      try {
        results = await searchWith(provider, query, options);
        answered = true;
      } catch (error) {
        bench(provider, error);
        lastError = error;
      }
    }
    if (!answered) throw lastError;
  }

  // Full page text, when asked for and the provider didn't send it: fetched
  // politely ourselves (never LinkedIn), only for results worth reading.
  if (options.rawContent) {
    const worthReading = typeof options.rawContent === "function" ? options.rawContent : () => true;
    await Promise.all(
      results
        .filter((r) => !r.raw_content && !/linkedin\.com/.test(r.url!) && worthReading({ url: r.url!, title: r.title, content: r.content }))
        .map(async (r) => (r.raw_content = await fetchPageText(r.url!))),
    );
  }
  return results;
}
