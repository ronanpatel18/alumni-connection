import { afterEach, describe, expect, it, vi } from "vitest";
import { createAi } from "@/lib/ai";
import { loadAiConfig } from "@/lib/ai/config";
import { lookupPerson, selectSources } from "@/lib/enrichment/person-lookup";
import { searchProviders, type SearchResult, webSearch } from "@/lib/enrichment/providers";
import { cleanName, looksLikeName } from "@/lib/enrichment/save-person";

const KEYS = ["KEENABLE_API_KEY", "KEENABLE_KEYLESS", "SERPER_API_KEY", "EXA_API_KEY", "LINKUP_API_KEY", "PARALLEL_API_KEY", "TAVILY_API_KEY", "SEARCH_PROVIDER"];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function onlyKeys(keys: Record<string, string>) {
  for (const key of KEYS) vi.stubEnv(key, keys[key] ?? "");
}

/** Answers each provider's API in its own response shape. */
function stubProviders(failing: string[] = []) {
  const calls: { host: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: { body: string; headers: Record<string, string> }) => {
    const host = new URL(url).hostname;
    calls.push({ host, body: JSON.parse(init.body), headers: init.headers });
    if (failing.includes(host)) return new Response("out of credit", { status: 402 });
    const page = { title: `From ${host}`, url: `https://example.com/${host}`, text: "Jane Doe" };
    const bodies: Record<string, unknown> = {
      "api.keenable.ai": { results: [{ title: page.title, url: page.url, snippet: page.text }, { title: "Shared", url: "https://example.com/shared", snippet: "short" }] },
      "google.serper.dev": { organic: [{ title: page.title, link: page.url, snippet: page.text }, { title: "Shared", link: "https://www.example.com/shared/", snippet: "the longer snippet" }] },
      "api.exa.ai": { results: [{ title: page.title, url: page.url, highlights: [page.text] }] },
      "api.linkup.so": { results: [{ type: "text", name: page.title, url: page.url, content: page.text }, { type: "image", name: "x", url: "https://example.com/x.png" }] },
      "api.parallel.ai": { results: [{ title: page.title, url: page.url, excerpts: [page.text] }] },
    };
    return Response.json(bodies[host]);
  });
  return calls;
}

describe("search providers", () => {
  const all = { KEENABLE_API_KEY: "k", SERPER_API_KEY: "s", EXA_API_KEY: "e", LINKUP_API_KEY: "l", PARALLEL_API_KEY: "p" };

  it("uses every provider that has a key, and SearXNG when none does", () => {
    onlyKeys({});
    expect(searchProviders().filter((p) => p.active).map((p) => p.name)).toEqual(["searxng"]);
    onlyKeys({ EXA_API_KEY: "e", SERPER_API_KEY: "s", TAVILY_API_KEY: "t" });
    expect(searchProviders().filter((p) => p.active).map((p) => p.name)).toEqual(["serper", "exa"]);
    onlyKeys({ ...all, SEARCH_PROVIDER: "linkup" });
    expect(searchProviders().filter((p) => p.active).map((p) => p.name)).toEqual(["linkup"]);
  });

  it("asks all five at once and merges their results", async () => {
    onlyKeys(all);
    const calls = stubProviders();
    const results = await webSearch('"Jane Doe" "University of Wisconsin"', { maxResults: 5, spread: "all" });
    expect(calls.map((c) => c.host).sort()).toEqual(["api.exa.ai", "api.keenable.ai", "api.linkup.so", "api.parallel.ai", "google.serper.dev"]);
    expect(results.map((r) => r.provider).sort()).toEqual(["exa", "keenable", "keenable", "linkup", "parallel", "serper"]);
    // The page two providers found is kept once, with the longer snippet.
    expect(results.filter((r) => r.url?.includes("shared"))).toMatchObject([{ content: "the longer snippet" }]);
  });

  it("sends each API its own request shape", async () => {
    onlyKeys(all);
    const calls = stubProviders();
    await webSearch('"Jane Doe" (BBA OR MBA)', { maxResults: 4, includeDomains: ["wisc.edu"], spread: "all" });
    const by = Object.fromEntries(calls.map((c) => [c.host, c]));
    expect(by["api.keenable.ai"]).toMatchObject({ headers: { "X-API-Key": "k" }, body: { query: '"Jane Doe" (BBA OR MBA) site:wisc.edu', max_results: 4 } });
    expect(by["google.serper.dev"]).toMatchObject({ headers: { "X-API-KEY": "s" }, body: { q: '"Jane Doe" (BBA OR MBA) site:wisc.edu', num: 4 } });
    expect(by["api.exa.ai"]).toMatchObject({ headers: { "x-api-key": "e" }, body: { query: "Jane Doe BBA MBA", numResults: 4, includeDomains: ["wisc.edu"] } });
    expect(by["api.linkup.so"]).toMatchObject({ headers: { Authorization: "Bearer l" }, body: { q: '"Jane Doe" (BBA OR MBA)', depth: "standard", outputType: "searchResults", includeDomains: ["wisc.edu"] } });
    expect(by["api.parallel.ai"]).toMatchObject({
      headers: { "x-api-key": "p" },
      body: { search_queries: ["Jane Doe BBA MBA"], advanced_settings: { max_results: 4, source_policy: { include_domains: ["wisc.edu"] } } },
    });
  });

  it("drops results outside the requested sites", async () => {
    onlyKeys({ SERPER_API_KEY: "s" });
    stubProviders();
    expect(await webSearch("Jane Doe", { maxResults: 5, includeDomains: ["wisc.edu"] })).toEqual([]);
  });

  it("passes a search on when a provider is out of credit, then leaves that provider out", async () => {
    onlyKeys({ SERPER_API_KEY: "s", LINKUP_API_KEY: "l" });
    const calls = stubProviders(["google.serper.dev"]);
    const first = await webSearch("Jane Doe", { maxResults: 5, spread: "all" });
    expect(first.map((r) => r.provider)).toEqual(["linkup"]);
    calls.length = 0;
    await webSearch("Jane Doe", { maxResults: 5 });
    await webSearch("Jane Doe", { maxResults: 5 });
    expect(calls.map((c) => c.host)).toEqual(["api.linkup.so", "api.linkup.so"]);
  });
});

const page = (url: string, title: string, content: string, raw: string | null = null): SearchResult => ({ url, title, content, raw_content: raw });

describe("selectSources", () => {
  it("keeps pages that tie the name to UW–Madison and drops namesakes", () => {
    const { kept } = selectSources({ fullName: "Jane Doe" }, [
      page("https://news.wisc.edu/jane", "Jane Doe honored", "Jane Doe (BBA ’04) leads…"),
      page("https://example.com/other", "Jane Doe, dentist", "Jane Doe practices in Ohio."),
      page("https://example.com/smith", "John Smith", "A University of Wisconsin story."),
      page("https://www.linkedin.com/company/acme", "Acme | LinkedIn", "Jane Doe University of Wisconsin-Madison"),
    ]);
    expect(kept.map((k) => k.result.url)).toEqual(["https://news.wisc.edu/jane"]);
  });

  it("uses the LinkedIn profile that mentions UW–Madison or the hint", () => {
    const profiles = [
      page("https://www.linkedin.com/in/jane-doe-1", "Jane Doe - Nurse", "Education: Ohio State University"),
      page("https://www.linkedin.com/in/jane-doe-2", "Jane Doe - Analyst at Epic", "Education: University of Wisconsin-Madison"),
    ];
    expect(selectSources({ fullName: "Jane Doe" }, profiles).linkedin?.result.url).toBe("https://www.linkedin.com/in/jane-doe-2");
    expect(selectSources({ fullName: "Jane Doe", hint: "nurse" }, [profiles[0]]).linkedin?.result.url).toBe("https://www.linkedin.com/in/jane-doe-1");
  });

  it("uses no LinkedIn profile when two fit equally well", () => {
    const { linkedin, notes } = selectSources({ fullName: "Jane Doe" }, [
      page("https://www.linkedin.com/in/jane-doe-1", "Jane Doe - Nurse", "University of Wisconsin-Madison"),
      page("https://www.linkedin.com/in/jane-doe-2", "Jane Doe - Analyst", "University of Wisconsin-Madison"),
    ]);
    expect(linkedin).toBeNull();
    expect(notes[0]).toMatch(/2 LinkedIn profiles/);
  });
});

describe("lookupPerson", () => {
  // Fixture mode calls no model, so this covers what plain patterns find.
  const ai = createAi(loadAiConfig({ AI_MODE: "fixture" }));

  it("reads class year, jobs and location from the sources", async () => {
    const search = (async (query: string) =>
      query.includes("linkedin")
        ? [
            page(
              "https://www.linkedin.com/in/jane-doe-2?trk=x",
              "Jane Doe - Epic | LinkedIn",
              "## Experience - Team Lead at Epic (Jun 2015 to present) - Analyst at Acme Corp (Jul 2004 to May 2015) ## Education - University of Wisconsin-Madison, Bachelor of Business Administration (BBA), Finance Location: Madison, Wisconsin, United States",
            ),
          ]
        : [page("https://news.wisc.edu/jane", "Jane Doe honored", "Jane Doe (BBA ’04) of Epic was honored by the University of Wisconsin.")]) as typeof webSearch;
    const found = await lookupPerson({ fullName: "Jane Doe" }, { ai, industries: [], search });
    expect(found.linkedinUrl).toBe("https://www.linkedin.com/in/jane-doe-2");
    expect(found.alumniStatus).toBe("source_stated");
    expect(found.educations).toMatchObject([{ degree: "BBA", gradYear: 2004, major: "Finance", sourceUrl: "https://news.wisc.edu/jane" }]);
    expect(found.positions.map((p) => [p.title, p.organization, p.isCurrent, p.startDate])).toEqual([
      ["Team Lead", "Epic", true, "2015-06-01"],
      ["Analyst", "Acme Corp", false, "2004-07-01"],
    ]);
    expect(found.location).toMatchObject({ city: "Madison", state: "WI" });
    expect(found.notes).toEqual([]);
  });

  it("says so when nothing ties the name to UW–Madison", async () => {
    const found = await lookupPerson({ fullName: "Jane Doe" }, { ai, industries: [], search: (async () => []) as typeof webSearch });
    expect(found.educations).toEqual([]);
    expect(found.notes[0]).toMatch(/No public page/);
  });
});

describe("names typed by an administrator", () => {
  it("tidies capitals and spacing", () => {
    expect(cleanName("  jane   doe ")).toBe("Jane Doe");
    expect(cleanName("MARY-ANN O'NEIL")).toBe("Mary-Ann O'Neil");
    expect(cleanName("Jane McDonald")).toBe("Jane McDonald");
  });

  it("tells names from other text", () => {
    expect(looksLikeName("John Q. Public")).toBe(true);
    expect(looksLikeName("José Núñez")).toBe(true);
    expect(looksLikeName("Madonna")).toBe(false);
    expect(looksLikeName("https://linkedin.com/in/jane")).toBe(false);
    expect(looksLikeName("Jane Doe 2004")).toBe(false);
  });
});

describe("class years a speaker mentions", () => {
  it("doesn't take the class someone addressed for their own", async () => {
    const { findClassYears } = await import("@/lib/enrichment/class-year");
    const text = "“I missed my own graduation ceremony here in 1971 so I’m really going to enjoy this with the class of 2012,” says Bartz of the University of Wisconsin.";
    expect(findClassYears(text, { uwContext: true, about: { fullName: "Carol Bartz", pageIsAboutThem: true } })).toEqual([]);
  });
});
