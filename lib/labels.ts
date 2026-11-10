// Plain display labels, safe to import from client components.

export const OPEN_TO_LABELS: Record<string, string> = {
  networking: "Networking",
  mentoring: "Mentoring",
  hiring: "Hiring",
  job_seeking: "Job seeking",
  investing: "Investing",
  fundraising: "Fundraising",
  referrals: "Referrals",
  meeting_travelers: "Meeting travelers",
  speaking: "Speaking",
};

export const SENIORITY_LABELS: Record<string, string> = {
  entry: "Early career",
  mid: "Mid-career",
  senior: "Senior professional",
  manager: "Manager",
  director: "Director",
  vp: "Vice president",
  c_suite: "Executive",
  partner: "Partner",
  owner: "Owner or founder",
};

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** "BBA, Finance" — drops a major the degree already names, fixes lowercase majors. */
export function formatDegree(degree: string | null, major: string | null): string | null {
  const d = degree?.trim() || null;
  let m = major?.trim() || null;
  if (m && d && d.toLowerCase().includes(m.toLowerCase())) m = null;
  return [d, m && capitalize(m)].filter(Boolean).join(", ") || null;
}

/** Why a profile is in the admin review queue (codes from profile_review_reasons). */
export const REVIEW_REASON_LABELS: Record<string, string> = {
  class_year: "Class year missing",
  alumni_status: "UW degree not confirmed",
  role: "Role or employer incomplete",
  location: "Location missing",
  industry: "Industry missing",
};

export const ALUMNI_STATUS_LABELS: Record<string, string> = {
  confirmed: "Confirmed UW–Madison alum",
  source_stated: "A source states a UW–Madison degree",
  likely: "Likely an alum (not stated outright)",
  unknown: "Unknown",
  not_alumnus: "Not a UW–Madison alum",
};

/** Two-letter initials for an avatar ("Tim Bratland" → "TB", "you@example.com" → "YE"). */
export function initialsFor(name: string) {
  return name
    .split(/[\s@._-]+/)
    .filter((part) => /^[A-Za-z]/.test(part))
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

/** Why a found contact detail needs an administrator (codes from contact_findings.review_reasons). */
export const CONTACT_REVIEW_REASON_LABELS: Record<string, string> = {
  low_confidence: "May be someone else’s",
  conflict: "Conflicts with another finding",
  personal: "Personal detail",
  third_party_phone: "Phone from a third party",
  pattern: "Pattern-based address",
  unverified: "Validity not confirmed",
};

/** What a validity check said (contact_findings.verification.status). */
export const CONTACT_CHECK_LABELS: Record<string, string> = {
  valid: "Passed a verifier",
  domain_ok: "Mail domain works; address not individually verified",
  risky: "Domain accepts any address; can’t be confirmed",
  unknown: "Not checked",
  invalid: "Failed",
};
