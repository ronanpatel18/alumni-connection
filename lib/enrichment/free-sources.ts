// Search sources that need no API key and cost nothing, so enrichment doesn't
// depend on one paid search provider (Tavily is now optional):
//   - UW–Madison's own websites, through their built-in WordPress site search
//     (news stories, the alumni magazine's class notes, the foundation, WSB).
//     These write alumni as "Name (BBA '94)" or "Name ’94".
//   - Wikipedia's search and article text.
// Each returns pages as plain text; the caller decides what counts.
import type { Snippet } from "./search";

// Header values must be plain ASCII (an en dash here makes every request fail).
const USER_AGENT = "AlumniConnect/0.1 (UW-Madison alumni directory; local development)";

/** UW–Madison sites with an open WordPress search (checked 2026-11-04). */
export const UW_WORDPRESS_SITES = [
  "https://business.wisc.edu",
  "https://news.wisc.edu",
  "https://onwisconsin.uwalumni.com",
  "https://www.supportuw.org",
  "https://engineering.wisc.edu",
];

// Be a polite client: one request at a time per host with a pause between
// them, a single backed-off retry on 429, and a week-long cache on disk
// (git-ignored) so re-runs don't hit these sites again.
const CACHE_FILE = "data/private/free-sources-cache.json";
const CACHE_MS = 7 * 86_400_000;
const PAUSE_MS = 400;
let cache: Record<string, { at: number; body: unknown }> | null = null;
const lastRequestAt = new Map<string, number>();
const hostQueue = new Map<string, Promise<unknown>>();

async function loadCache() {
  if (cache) return cache;
  const { existsSync, readFileSync } = await import("node:fs");
  cache = existsSync(CACHE_FILE) ? JSON.parse(readFileSync(CACHE_FILE, "utf8")) : {};
  return cache!;
}

async function saveCache() {
  const { mkdirSync, writeFileSync } = await import("node:fs");
  mkdirSync("data/private", { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(cache));
}

async function politeFetch(url: string, accept = "application/json"): Promise<Response | null> {
  const host = new URL(url).host;
  const run = async () => {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const wait = (lastRequestAt.get(host) ?? 0) + PAUSE_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastRequestAt.set(host, Date.now());
      try {
        const response = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: accept }, signal: AbortSignal.timeout(15_000) });
        if (response.status === 429 && attempt === 1) {
          const retryAfter = Number(response.headers.get("retry-after")) || 30;
          await new Promise((r) => setTimeout(r, Math.min(retryAfter, 60) * 1000));
          continue;
        }
        return response;
      } catch {
        return null;
      }
    }
    return null;
  };
  const queued = (hostQueue.get(host) ?? Promise.resolve()).then(run, run);
  hostQueue.set(host, queued);
  return queued;
}

async function getJson<T>(url: string): Promise<T | null> {
  const store = await loadCache();
  const hit = store[url];
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.body as T;
  const response = await politeFetch(url);
  if (!response?.ok) return null;
  try {
    const body = (await response.json()) as T;
    store[url] = { at: Date.now(), body };
    await saveCache();
    return body;
  } catch {
    return null;
  }
}

/** A web page as plain text (cached, polite, HTML only, at most 60k characters). */
export async function fetchPageText(url: string): Promise<string | null> {
  const store = await loadCache();
  const key = `page:${url}`;
  const hit = store[key];
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.body as string | null;
  const response = await politeFetch(url, "text/html");
  let text: string | null = null;
  if (response?.ok && (response.headers.get("content-type") ?? "").includes("text/html")) {
    try {
      text = htmlToText(await response.text()).slice(0, 60_000);
    } catch {
      text = null;
    }
  }
  store[key] = { at: Date.now(), body: text };
  await saveCache();
  return text;
}

/** HTML to readable text, keeping paragraph and line breaks (they separate people in lists). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#8217;|&rsquo;/g, "’")
    .replace(/&#8216;|&lsquo;/g, "‘")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#8211;|&ndash;/g, "–")
    .replace(/&#8212;|&mdash;/g, "—")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

interface WpSearchHit {
  title: string;
  url: string;
  _links?: { self?: { href: string }[] };
}

/**
 * Searches each UW site for the person's full name and returns the matching
 * pages' text (up to `perSite` pages a site). Pages that don't contain the
 * full name are dropped.
 */
export async function searchUwSites(fullName: string, { perSite = 4 } = {}): Promise<Snippet[]> {
  const name = fullName.replace(/\b[A-Z]\.\s*/g, "").trim();
  const results = await Promise.all(
    UW_WORDPRESS_SITES.map(async (site) => {
      const hits = await getJson<WpSearchHit[]>(`${site}/wp-json/wp/v2/search?search=${encodeURIComponent(name)}&per_page=${perSite}`);
      if (!hits?.length) return [];
      const pages = await Promise.all(
        hits.map(async (hit) => {
          const href = hit._links?.self?.[0]?.href;
          if (!href) return null;
          const item = await getJson<{ title?: { rendered: string }; content?: { rendered: string } }>(href);
          if (!item?.content?.rendered) return null;
          const title = htmlToText(item.title?.rendered ?? hit.title);
          const text = htmlToText(item.content.rendered);
          return { url: hit.url, title, text: `${title}\n${text.slice(0, 600)}`, page: `${title}\n${text}` } as Snippet;
        }),
      );
      return pages.filter((p): p is Snippet => Boolean(p));
    }),
  );
  const lastName = name.split(/\s+/).pop()!.toLowerCase();
  return results.flat().filter((p) => p.page!.toLowerCase().includes(lastName));
}

/** Wikipedia articles that mention the person and UW, as plain text. */
export async function searchWikipedia(fullName: string, { limit = 3 } = {}): Promise<Snippet[]> {
  const search = await getJson<{ query?: { search?: { title: string }[] } }>(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=${limit}&srsearch=${encodeURIComponent(`"${fullName}" Wisconsin`)}`,
  );
  const titles = search?.query?.search?.map((s) => s.title) ?? [];
  if (!titles.length) return [];
  const pages = await getJson<{ query?: { pages?: Record<string, { title: string; extract?: string }> } }>(
    `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&format=json&titles=${encodeURIComponent(titles.join("|"))}`,
  );
  return Object.values(pages?.query?.pages ?? {})
    .filter((p) => p.extract)
    .map((p) => ({
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, "_"))}`,
      title: p.title,
      text: p.extract!.slice(0, 600),
      page: p.extract!,
    }));
}
