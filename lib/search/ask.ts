// Prompt search ("describe who you want to meet"): the filters a request ended
// up with, the links that edit them, and the plain-fact evidence line shown
// before any AI text. Pure functions, so they can be unit-tested.
import type { ParsedQuery } from "@/lib/ai/schemas";
import { OPEN_TO_LABELS, SENIORITY_LABELS } from "@/lib/labels";

export const ASK_MAX_LENGTH = 500;
export const ASK_DEFAULT_RADIUS = 50;

export interface AskFilters {
  industrySlugs: string[];
  placeId: number | null;
  radius: number;
  gradFrom: number | null;
  gradTo: number | null;
  openTo: string[];
  seniority: string[];
  confirmedOnly: boolean;
}

export type AskParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const all = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean);
const toInt = (v: string) => (/^\d+$/.test(v) ? Number(v) : null);

export const askText = (params: AskParams) => first(params.ask).trim().slice(0, ASK_MAX_LENGTH);

/**
 * The filters in effect. Until the member edits anything they come from the
 * parsed request; after that (`edited=1`) only from the URL, so a filter the
 * member removed is never parsed straight back in.
 */
export function effectiveFilters(params: AskParams, parsed: ParsedQuery, parsedPlaceId: number | null): AskFilters {
  const confirmedOnly = first(params.confirmed) === "1";
  if (first(params.edited) === "1") {
    const placeId = toInt(first(params.place));
    return {
      industrySlugs: all(params.industry),
      placeId,
      radius: toInt(first(params.radius)) ?? ASK_DEFAULT_RADIUS,
      gradFrom: toInt(first(params.from)),
      gradTo: toInt(first(params.to)),
      openTo: all(params.open),
      seniority: all(params.level),
      confirmedOnly,
    };
  }
  return {
    industrySlugs: parsed.industrySlugs,
    placeId: parsedPlaceId,
    radius: parsed.radiusMiles ?? ASK_DEFAULT_RADIUS,
    gradFrom: parsed.gradYearMin,
    gradTo: parsed.gradYearMax,
    openTo: parsed.openTo,
    seniority: parsed.seniority,
    confirmedOnly,
  };
}

/** A prompt-search link with every filter written out, marked as edited. */
export function askHref(ask: string, filters: AskFilters, changes: Partial<AskFilters> = {}) {
  const f = { ...filters, ...changes };
  const url = new URLSearchParams({ ask, edited: "1" });
  for (const slug of f.industrySlugs) url.append("industry", slug);
  if (f.placeId !== null) {
    url.set("place", String(f.placeId));
    url.set("radius", String(f.radius));
  }
  if (f.gradFrom !== null) url.set("from", String(f.gradFrom));
  if (f.gradTo !== null) url.set("to", String(f.gradTo));
  for (const value of f.openTo) url.append("open", value);
  for (const value of f.seniority) url.append("level", value);
  if (f.confirmedOnly) url.set("confirmed", "1");
  return `/search/ask?${url.toString()}`;
}

export interface AskChip {
  key: string;
  label: string;
  /** Where removing this filter leads. */
  href: string;
}

export interface AskNames {
  industry: (slug: string) => string;
  place: { name: string; state: string } | null;
}

function classLabel({ gradFrom, gradTo }: AskFilters) {
  if (gradFrom === null && gradTo === null) return null;
  return gradFrom === gradTo ? String(gradFrom) : `${gradFrom ?? "…"}–${gradTo ?? "…"}`;
}

/** One removable chip per understood filter, so a misreading is one click to fix. */
export function askChips(ask: string, filters: AskFilters, names: AskNames): AskChip[] {
  const chips: AskChip[] = [];
  if (names.place) {
    chips.push({ key: "place", label: `Near: ${names.place.name}, ${names.place.state} (${filters.radius} mi)`, href: askHref(ask, filters, { placeId: null }) });
  }
  for (const slug of filters.industrySlugs) {
    chips.push({
      key: `industry-${slug}`,
      label: `Industry: ${names.industry(slug)}`,
      href: askHref(ask, filters, { industrySlugs: filters.industrySlugs.filter((s) => s !== slug) }),
    });
  }
  const years = classLabel(filters);
  if (years) chips.push({ key: "class", label: `Class: ${years}`, href: askHref(ask, filters, { gradFrom: null, gradTo: null }) });
  for (const value of filters.openTo) {
    chips.push({
      key: `open-${value}`,
      label: `Open to: ${OPEN_TO_LABELS[value] ?? value}`,
      href: askHref(ask, filters, { openTo: filters.openTo.filter((o) => o !== value) }),
    });
  }
  for (const value of filters.seniority) {
    chips.push({
      key: `level-${value}`,
      label: `Level: ${SENIORITY_LABELS[value] ?? value}`,
      href: askHref(ask, filters, { seniority: filters.seniority.filter((s) => s !== value) }),
    });
  }
  if (filters.confirmedOnly) chips.push({ key: "confirmed", label: "Confirmed only", href: askHref(ask, filters, { confirmedOnly: false }) });
  return chips;
}

export interface AskMatch {
  matched: string[];
  industry_name?: string | null;
  city: string | null;
  metro?: string | null;
  grad_year: number | null;
  seniority: string | null;
  open_to: string[] | null;
  status: string;
}

/**
 * The stored facts a person's place in the list rests on, shown at once and
 * never AI-written. Only preferences this person actually meets are listed.
 */
export function askEvidence(person: AskMatch, filters: AskFilters): string[] {
  const out: string[] = [];
  const market = person.metro ?? person.city;
  if (filters.placeId !== null && market) out.push(market);
  if (person.matched.includes("industry") && person.industry_name) out.push(person.industry_name);
  if (person.matched.includes("class") && person.grad_year) out.push(`Class of ${person.grad_year}`);
  if (person.matched.includes("seniority") && person.seniority) out.push(SENIORITY_LABELS[person.seniority] ?? person.seniority);
  if (person.matched.includes("open_to")) {
    for (const value of filters.openTo) {
      if ((person.open_to ?? []).includes(value)) out.push(`open to ${(OPEN_TO_LABELS[value] ?? value).toLowerCase()}`);
    }
  }
  if (person.matched.includes("keywords")) out.push("profile mentions your keywords");
  if (!person.matched.length) out.push("similar to your description");
  if (person.status === "claimed" || person.status === "verified") out.push("confirmed profile");
  return out;
}
