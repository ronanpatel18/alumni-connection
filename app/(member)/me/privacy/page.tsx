import type { Metadata } from "next";
import { Suspense } from "react";
import { DialogButton } from "@/components/dialog-button";
import { Icon } from "@/components/icon";
import { NoProfileNotice } from "@/components/no-profile";
import { PageTitle } from "@/components/person";
import { ProfileTabs } from "@/components/profile-tabs";
import { loadMyProfile } from "@/lib/my-profile";
import { requireMember } from "@/lib/viewer";
import { removeMyProfile } from "../actions";
import { type ContactRow, ContactsForm } from "./contacts-form";

export const metadata: Metadata = { title: "Privacy & visibility" };

const KINDS: Omit<ContactRow, "value" | "visibility" | "verified">[] = [
  { kind: "email", label: "Email address", type: "email", placeholder: "Not provided" },
  { kind: "phone", label: "Phone number", type: "tel", placeholder: "Not provided" },
  { kind: "website", label: "Website", type: "url", placeholder: "https://" },
  { kind: "linkedin", label: "LinkedIn", type: "url", placeholder: "https://www.linkedin.com/in/…" },
];

async function Privacy() {
  const viewer = await requireMember("/me/privacy");
  const profile = await loadMyProfile(viewer);
  if (!profile) return <NoProfileNotice />;

  const rows: ContactRow[] = KINDS.map((k) => {
    const point =
      profile.contact_points.find((c) => c.kind === k.kind && c.source === "self") ?? profile.contact_points.find((c) => c.kind === k.kind);
    return { ...k, value: point?.value ?? "", visibility: point?.visibility ?? "members", verified: Boolean(point?.verified_at) };
  });

  return (
    <div className="split">
      <ContactsForm rows={rows} />
      <aside className="right-rail stack">
        <section className="panel pad">
          <h2 className="rail-title">Private from the start</h2>
          <div className="rail-list">
            <div className="od-row-top">
              <Icon name="lock" />
              <p className="small muted">Your profile is never public or indexed by search engines.</p>
            </div>
            <div className="od-row-top">
              <Icon name="intro" />
              <p className="small muted">Introductions require agreement from the connector and the recipient.</p>
            </div>
          </div>
        </section>
        <section className="panel pad">
          <h3>Leave the network</h3>
          <p className="small muted" style={{ margin: "12px 0" }}>
            Removal needs no explanation and prevents future re-import.
          </p>
          <DialogButton label="Remove my profile" title="Remove your profile?" className="btn danger">
            <p className="small muted">
              This deletes your profile, its contact details and any notes members kept about you, and signs you out. A minimal
              record is kept only so you aren’t added again. This can’t be undone.
            </p>
            <form action={removeMyProfile} className="form-actions">
              <button type="submit" className="btn danger">
                Remove my profile now
              </button>
            </form>
          </DialogButton>
        </section>
      </aside>
    </div>
  );
}

export default function PrivacyPage() {
  return (
    <>
      <PageTitle
        eyebrow="Profile & privacy"
        title="Your privacy, in plain sight."
        description="Choose who can see each contact detail. You can change these settings at any time."
      />
      <ProfileTabs />
      <Suspense fallback={<div className="panel pad"><div className="skeleton big" /><div className="skeleton" /></div>}>
        <Privacy />
      </Suspense>
    </>
  );
}
