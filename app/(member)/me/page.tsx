import type { Metadata } from "next";
import { Suspense } from "react";
import { ContactPrompt } from "@/components/contact-prompt";
import { NoProfileNotice } from "@/components/no-profile";
import { isConfirmed, PageTitle } from "@/components/person";
import { ProfileTabs } from "@/components/profile-tabs";
import { loadMyProfile } from "@/lib/my-profile";
import { getVocabulary } from "@/lib/search/vocabulary";
import { requireMember } from "@/lib/viewer";
import { EditProfileForm } from "./edit-profile-form";

export const metadata: Metadata = { title: "Edit profile" };

async function EditProfile() {
  const viewer = await requireMember("/me");
  const [profile, { industries, places }] = await Promise.all([loadMyProfile(viewer), getVocabulary()]);
  if (!profile) return <NoProfileNotice />;

  const education = [...profile.educations].sort((a, b) => (a.grad_year ?? 9999) - (b.grad_year ?? 9999))[0];
  const sectors = industries.filter((i) => i.parent_id === null);
  return (
    <EditProfileForm
      confirmed={isConfirmed(profile.status)}
      defaults={{
        full_name: profile.full_name,
        current_title: profile.current_title ?? "",
        employer: profile.organizations?.name ?? "",
        place_id: profile.place_id ? String(profile.place_id) : "",
        current_city: [profile.city, profile.state].filter(Boolean).join(", "),
        industry_id: profile.industry_id ? String(profile.industry_id) : "",
        class_year: education?.grad_year ? String(education.grad_year) : "",
        school: education?.school ?? "",
        degree_major: [education?.degree, education?.major].filter(Boolean).join(", "),
        open_to: profile.open_to,
        bio: profile.bio ?? "",
      }}
      places={places.map((p) => ({ value: String(p.id), label: `${p.name}, ${p.state}` }))}
      industries={sectors.map((sector) => ({
        sector: sector.name,
        options: [sector, ...industries.filter((i) => i.parent_id === sector.id)].map((i) => ({
          value: String(i.id),
          label: i.id === sector.id ? `All of ${i.name}` : i.name,
        })),
      }))}
    />
  );
}

export default function EditProfilePage() {
  return (
    <>
      <PageTitle
        eyebrow="Profile & privacy / Edit profile"
        title="Make it yours."
        description="Keep your professional story accurate. You decide which contact details to share."
      />
      <ProfileTabs />
      <Suspense fallback={null}>
        <div className="narrow" style={{ marginBottom: 24 }}>
          <ContactPrompt />
        </div>
      </Suspense>
      <Suspense fallback={<div className="narrow panel pad"><div className="skeleton big" /><div className="skeleton" /></div>}>
        <EditProfile />
      </Suspense>
    </>
  );
}
