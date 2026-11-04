// The filters a search ended up with, whether they were typed into the search
// box or chosen from the form, and the links and copy built from them.
import { OPEN_TO_LABELS } from "@/lib/labels";

export interface ActiveFilters {
  /** Leftover keywords, after everything recognizable has become a filter. */
  text: string | null;
  industrySlugs: string[];
  placeId: number | null;
  radius: number;
  gradFrom: number | null;
  gradTo: number | null;
  openTo: string[];
  groupSlug: string | null;
  confirmedOnly: boolean;
}

/** Display names for the ids in ActiveFilters. */
export interface FilterNames {
  industry: (slug: string) => string;
  place: { name: string; state: string } | null;
  group: string | null;
}

export interface FilterChip {
  key: string;
  label: string;
  href: string;
}

export interface SearchRecovery {
  title: string;
  text: string;
  actionLabel: string;
  href: string;
}

/**
 * A search link with every filter written out explicitly. The original search
 * text is left out on purpose: a filter it implied would otherwise be parsed
 * straight back in, so nothing could be removed.
 */
export function filterHref(active: ActiveFilters, changes: Partial<ActiveFilters> = {}) {
  const f = { ...active, ...changes };
  const url = new URLSearchParams();
  if (f.text) url.set("q", f.text);
  for (const slug of f.industrySlugs) url.append("industry", slug);
  if (f.placeId !== null) {
    url.set("place", String(f.placeId));
    url.set("radius", String(f.radius));
  }
  if (f.gradFrom !== null) url.set("from", String(f.gradFrom));
  if (f.gradTo !== null) url.set("to", String(f.gradTo));
  for (const value of f.openTo) url.append("open", value);
  if (f.groupSlug) url.set("group", f.groupSlug);
  if (f.confirmedOnly) url.set("confirmed", "1");
  const query = url.toString();
  return query ? `/search?${query}` : "/search";
}

const RADIUS_MILES = [10, 25, 50, 100, 250];
export const DEFAULT_RADIUS = 50;

/**
 * Choices for the radius dropdown. The radius in effect when nobody picked one
 * (typed into the search, or the default) submits as blank, so the form never
 * sends a radius that overrides "within 25 miles" in the search text.
 */
export function radiusChoices(typed: number | null, selected: number | null) {
  const unset = typed ?? DEFAULT_RADIUS;
  const miles = [...new Set([...RADIUS_MILES, unset, ...(selected === null ? [] : [selected])])].sort((a, b) => a - b);
  return {
    options: miles.map((m) => ({ value: m === unset ? "" : String(m), label: `${m} miles` })),
    defaultValue: selected === null || selected === unset ? "" : String(selected),
  };
}

const openToLabel = (value: string) => OPEN_TO_LABELS[value] ?? value;

function classLabel({ gradFrom, gradTo }: ActiveFilters) {
  if (gradFrom === null && gradTo === null) return null;
  return gradFrom === gradTo ? String(gradFrom) : `${gradFrom ?? "…"}–${gradTo ?? "…"}`;
}

/** One removable control per applied filter. */
export function filterChips(active: ActiveFilters, names: FilterNames): FilterChip[] {
  const chips: FilterChip[] = active.industrySlugs.map((slug) => ({
    key: `industry-${slug}`,
    label: `Industry: ${names.industry(slug)}`,
    href: filterHref(active, { industrySlugs: active.industrySlugs.filter((s) => s !== slug) }),
  }));
  if (names.place) {
    chips.push({
      key: "place",
      label: `Near: ${names.place.name}, ${names.place.state} (${active.radius} mi)`,
      href: filterHref(active, { placeId: null }),
    });
  }
  const years = classLabel(active);
  if (years) chips.push({ key: "class", label: `Class: ${years}`, href: filterHref(active, { gradFrom: null, gradTo: null }) });
  for (const value of active.openTo) {
    chips.push({
      key: `open-${value}`,
      label: `Open to: ${openToLabel(value)}`,
      href: filterHref(active, { openTo: active.openTo.filter((o) => o !== value) }),
    });
  }
  if (active.groupSlug) {
    chips.push({ key: "group", label: `Group: ${names.group ?? active.groupSlug}`, href: filterHref(active, { groupSlug: null }) });
  }
  if (active.text) chips.push({ key: "text", label: `Keywords: “${active.text}”`, href: filterHref(active, { text: null }) });
  return chips;
}

// "Data & AI" → "data & AI": mid-sentence case that keeps acronyms.
const midSentence = (name: string) => name.replace(/\b[A-Z][a-z]+/g, (word) => word.toLowerCase());

/** "technology alumni near Seattle", for use mid-sentence. Ignores the open-to preference. */
function describeMarket(active: ActiveFilters, names: FilterNames, count?: number) {
  const parts = [
    active.confirmedOnly && "confirmed",
    active.industrySlugs.map((slug) => midSentence(names.industry(slug))).join(" and "),
    count === 1 ? "alumnus" : "alumni",
    names.place && `near ${names.place.name}`,
    classLabel(active) && `from the class of ${classLabel(active)}`,
    active.groupSlug && `in ${names.group ?? active.groupSlug}`,
    active.text && `matching “${active.text}”`,
  ];
  return parts.filter(Boolean).join(" ");
}

/**
 * What to offer when an open-to preference leaves no results. `withoutPreference`
 * is the same search's total with the preference removed, which tells a market
 * nobody has opted into yet apart from one with nobody in it.
 */
export function preferenceRecovery(active: ActiveFilters, names: FilterNames, withoutPreference: number): SearchRecovery {
  const preference = active.openTo.map((value) => openToLabel(value).toLowerCase()).join(" or ");
  const market = describeMarket(active, names);

  if (withoutPreference === 0) {
    return {
      title: `No ${market} yet`,
      text: `That’s true with or without the ${preference} preference. Try a wider radius, a nearby market, or fewer filters.`,
      actionLabel: "Clear filters",
      href: "/search",
    };
  }
  return {
    title: `No one here is open to ${preference} yet`,
    text:
      `The directory has ${withoutPreference} ${describeMarket(active, names, withoutPreference)}, but ` +
      `${withoutPreference === 1 ? "they haven’t" : "none have"} said they’re open to ${preference} yet.`,
    actionLabel: market === "alumni" ? "Show all alumni" : `Show ${market}`,
    href: filterHref(active, { openTo: [] }),
  };
}
