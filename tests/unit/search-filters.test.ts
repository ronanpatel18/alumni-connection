import { describe, expect, it } from "vitest";
import { type ActiveFilters, filterChips, filterHref, type FilterNames, preferenceRecovery, radiusChoices } from "@/lib/search/filters";

const none: ActiveFilters = {
  text: null,
  industrySlugs: [],
  placeId: null,
  radius: 50,
  gradFrom: null,
  gradTo: null,
  openTo: [],
  groupSlug: null,
  confirmedOnly: false,
};
const seattleTech: ActiveFilters = { ...none, industrySlugs: ["technology"], placeId: 5, openTo: ["networking"] };
const names: FilterNames = {
  industry: (slug) => ({ technology: "Technology", "data-ai": "Data & AI" })[slug] ?? slug,
  place: { name: "Seattle", state: "WA" },
  group: null,
};
const noPlace: FilterNames = { ...names, place: null };

const paramsOf = (href: string) => new URL(href, "http://x").searchParams;

describe("filterHref", () => {
  it("links to the bare page when no filters are left", () => {
    expect(filterHref(none)).toBe("/search");
  });

  it("writes every filter out and leaves the original search text behind", () => {
    const params = paramsOf(filterHref({ ...seattleTech, gradFrom: 2005, gradTo: 2010, groupSlug: "wsb", confirmedOnly: true, text: "stripe" }));
    expect(Object.fromEntries(params)).toEqual({
      q: "stripe",
      industry: "technology",
      place: "5",
      radius: "50",
      from: "2005",
      to: "2010",
      open: "networking",
      group: "wsb",
      confirmed: "1",
    });
  });

  it("drops the radius along with the place", () => {
    expect(paramsOf(filterHref(seattleTech, { placeId: null })).has("radius")).toBe(false);
  });
});

describe("filterChips", () => {
  it("gives each filter a link that removes only that filter", () => {
    const chips = filterChips(seattleTech, names);
    expect(chips.map((c) => c.label)).toEqual(["Industry: Technology", "Near: Seattle, WA (50 mi)", "Open to: Networking"]);

    const withoutPreference = paramsOf(chips[2].href);
    expect(withoutPreference.has("open")).toBe(false);
    expect(withoutPreference.get("industry")).toBe("technology");
    expect(withoutPreference.get("place")).toBe("5");
  });

  it("removes one of several values on its own", () => {
    const chips = filterChips({ ...none, openTo: ["networking", "mentoring"] }, noPlace);
    expect(paramsOf(chips[0].href).getAll("open")).toEqual(["mentoring"]);
  });

  it("labels class years and keywords", () => {
    const chips = filterChips({ ...none, gradFrom: 2005, gradTo: null, text: "stripe" }, noPlace);
    expect(chips.map((c) => c.label)).toEqual(["Class: 2005–…", "Keywords: “stripe”"]);
  });

  it("shows nothing when no filters apply", () => {
    expect(filterChips(none, noPlace)).toEqual([]);
  });
});

describe("radiusChoices", () => {
  const valueFor = (choices: ReturnType<typeof radiusChoices>, label: string) => choices.options.find((o) => o.label === label)?.value;

  it("submits the default radius as blank, so it can't override the search text", () => {
    const choices = radiusChoices(null, null);
    expect(valueFor(choices, "50 miles")).toBe("");
    expect(valueFor(choices, "25 miles")).toBe("25");
    expect(choices.defaultValue).toBe("");
  });

  it("shows a typed radius as the unset choice, and 50 miles as a real one", () => {
    const choices = radiusChoices(25, null);
    expect(valueFor(choices, "25 miles")).toBe("");
    expect(valueFor(choices, "50 miles")).toBe("50");
    expect(choices.defaultValue).toBe("");
  });

  it("includes a typed radius that isn't a standard choice, in order", () => {
    expect(radiusChoices(30, null).options.map((o) => o.label)).toEqual(["10 miles", "25 miles", "30 miles", "50 miles", "100 miles", "250 miles"]);
  });

  it("keeps a radius chosen in the dropdown selected over a typed one", () => {
    expect(radiusChoices(25, 100).defaultValue).toBe("100");
  });

  it("selects a radius from a link, even one the dropdown doesn't list", () => {
    expect(radiusChoices(null, 50).defaultValue).toBe("");
    const choices = radiusChoices(null, 75);
    expect(choices.defaultValue).toBe("75");
    expect(valueFor(choices, "75 miles")).toBe("75");
  });
});

describe("preferenceRecovery", () => {
  it("offers the same market without the preference when alumni are there", () => {
    const recovery = preferenceRecovery(seattleTech, names, 3);
    expect(recovery.actionLabel).toBe("Show technology alumni near Seattle");
    expect(recovery.text).toBe("The directory has 3 technology alumni near Seattle, but none have said they’re open to networking yet.");
    const params = paramsOf(recovery.href);
    expect(params.has("open")).toBe(false);
    expect(params.get("place")).toBe("5");
  });

  it("uses the singular for one alumnus", () => {
    expect(preferenceRecovery(seattleTech, names, 1).text).toBe(
      "The directory has 1 technology alumnus near Seattle, but they haven’t said they’re open to networking yet.",
    );
  });

  it("says when the market itself is empty, rather than blaming the preference", () => {
    const recovery = preferenceRecovery(seattleTech, names, 0);
    expect(recovery.title).toBe("No technology alumni near Seattle yet");
    expect(recovery.href).toBe("/search");
  });

  it("keeps acronyms and every other filter in the wording", () => {
    const active = { ...seattleTech, industrySlugs: ["data-ai"], confirmedOnly: true, gradFrom: 2010, gradTo: 2010 };
    expect(preferenceRecovery(active, names, 2).actionLabel).toBe("Show confirmed data & AI alumni near Seattle from the class of 2010");
  });

  it("falls back to all alumni when the preference was the only filter", () => {
    const recovery = preferenceRecovery({ ...none, openTo: ["mentoring", "hiring"] }, noPlace, 66);
    expect(recovery.actionLabel).toBe("Show all alumni");
    expect(recovery.title).toBe("No one here is open to mentoring or hiring yet");
    expect(recovery.href).toBe("/search");
  });
});
