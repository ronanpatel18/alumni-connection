// Web search for enrichment via Tavily (free tier: 1,000 credits a month).
// Optional: without TAVILY_API_KEY, enrichment uses only stored bios.
import type { EnrichmentSource } from "@/lib/ai/schemas";

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
}

export function searchConfigured(): boolean {
  return Boolean(process.env.TAVILY_API_KEY);
}

async function tavily(query: string, options: { maxResults: number; includeDomains?: string[] }): Promise<TavilyResult[]> {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.TAVILY_API_KEY}` },
    body: JSON.stringify({
      query,
      max_results: options.maxResults,
      search_depth: "basic",
      include_answer: false,
      include_raw_content: false,
      ...(options.includeDomains ? { include_domains: options.includeDomains } : {}),
    }),
  });
  if (!response.ok) throw new Error(`Tavily search failed: ${response.status}`);
  const body = (await response.json()) as { results?: TavilyResult[] };
  return body.results ?? [];
}

/** Public pages likely to state where this person studied and lives. */
export async function searchPerson(
  person: { fullName: string; organizationName: string | null },
  firstSourceNumber: number,
): Promise<EnrichmentSource[]> {
  const query = `"${person.fullName}" ${person.organizationName ?? ""} University of Wisconsin`.trim();
  const results = await tavily(query, { maxResults: 5 });
  // Common names collide (a student and a CIO named Luke Anderson). Keep only pages
  // that also mention the person's employer or the Wisconsin School of Business.
  const orgWords = (person.organizationName ?? "")
    .toLowerCase()
    .split(/[^a-z0-9&]+/)
    .filter((w) => w.length >= 3 && !["the", "and", "group", "company", "corporation", "inc", "llc", "partners", "capital", "global", "services"].includes(w));
  const aboutThisPerson = (text: string) => {
    const t = text.toLowerCase();
    return /wisconsin school of business|advisory board/.test(t) || orgWords.some((w) => t.includes(w));
  };
  return results
    .filter((r) => r.url && r.content && !/linkedin\.com\/in\//.test(r.url))
    .filter((r) => aboutThisPerson(`${r.title ?? ""} ${r.content}`))
    .map((r, i) => ({ id: `S${firstSourceNumber + i}`, url: r.url!, text: `${r.title ?? ""}\n${r.content!}`.slice(0, 2500) }));
}

/**
 * Finds the person's public LinkedIn URL from search-result snippets (the
 * conference-connection heuristic): name tokens must match, and the employer
 * should. We never fetch LinkedIn itself.
 */
export async function findLinkedInUrl(person: { fullName: string; organizationName: string | null; title: string | null }): Promise<string | null> {
  const query = [person.fullName, person.title, person.organizationName, "linkedin"].filter(Boolean).join(" ");
  const results = (await tavily(query, { maxResults: 5, includeDomains: ["linkedin.com"] })).filter((r) =>
    /linkedin\.com\/in\//.test(r.url ?? ""),
  );

  const nameParts = person.fullName.toLowerCase().split(/\s+/).filter((p) => p.length > 2 && !/^[a-z]\.$/.test(p));
  let best: { url: string; score: number } | null = null;
  for (const result of results) {
    const haystack = `${result.title ?? ""} ${result.content ?? ""}`.toLowerCase();
    const nameHits = nameParts.filter((p) => haystack.includes(p)).length;
    if (nameHits < Math.min(2, nameParts.length)) continue;
    let score = nameHits * 10;
    if (person.organizationName && haystack.includes(person.organizationName.toLowerCase())) score += 15;
    if (!best || score > best.score) best = { url: result.url!.split("?")[0], score };
  }
  // Require an employer match unless the name match is unambiguous.
  return best && best.score >= 25 ? best.url : null;
}
