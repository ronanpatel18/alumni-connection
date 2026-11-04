import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Icon } from "@/components/icon";
import { NoProfileNotice } from "@/components/no-profile";
import { PageTitle } from "@/components/person";
import { ProfileTabs } from "@/components/profile-tabs";
import { loadMyProfile } from "@/lib/my-profile";
import { FIELD_LABELS, SOURCE_LABELS } from "@/lib/provenance";
import { requireMember } from "@/lib/viewer";

export const metadata: Metadata = { title: "Data sources" };

// Member-provided values win, so they're the source that counts when present.
const SOURCE_PRIORITY = ["self", "roster", "admin", "institution", "pdl", "web", "ai"];

async function Sources() {
  const viewer = await requireMember("/me/sources");
  const profile = await loadMyProfile(viewer);
  if (!profile) return <NoProfileNotice />;

  const byField = new Map<string, (typeof profile.field_provenance)[number]>();
  for (const row of [...profile.field_provenance].sort((a, b) => SOURCE_PRIORITY.indexOf(a.source) - SOURCE_PRIORITY.indexOf(b.source))) {
    if (!byField.has(row.field)) byField.set(row.field, row);
  }
  const rows = [...byField.values()].sort((a, b) => (FIELD_LABELS[a.field] ?? a.field).localeCompare(FIELD_LABELS[b.field] ?? b.field));

  return (
    <section className="panel">
      <div className="pad">
        <div className="notice">
          <Icon name="info" />
          <div>Anything you edit becomes member-provided and replaces what came from other sources.</div>
        </div>
      </div>
      <div className="table-wrap">
        <table className="responsive">
          <thead>
            <tr>
              <th>Profile detail</th>
              <th>Current source</th>
              <th>Updated</th>
              <th>Control</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.field}>
                <td>
                  <strong>{FIELD_LABELS[row.field] ?? row.field}</strong>
                </td>
                <td data-label="Source">
                  {SOURCE_LABELS[row.source] ?? row.source}
                  {row.source_url && (
                    <>
                      {" · "}
                      <a href={row.source_url} target="_blank" rel="noreferrer noopener">
                        source
                      </a>
                    </>
                  )}
                </td>
                <td data-label="Updated">{new Date(row.fetched_at).toLocaleDateString()}</td>
                <td>
                  <Link className="btn quiet" href={row.field === "contact_points" || row.field === "linkedin" ? "/me/privacy" : "/me"}>
                    Review / correct
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function SourcesPage() {
  return (
    <>
      <PageTitle
        eyebrow="Profile & privacy / Data sources"
        title="Know where your data comes from."
        description="Review the origin of your profile details and correct anything that needs attention."
      />
      <ProfileTabs />
      <Suspense fallback={<div className="panel pad"><div className="skeleton big" /></div>}>
        <Sources />
      </Suspense>
    </>
  );
}
