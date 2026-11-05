import type { Metadata } from "next";
import { Suspense } from "react";
import { NoProfileNotice } from "@/components/no-profile";
import { PageTitle } from "@/components/person";
import { loadMyProfile } from "@/lib/my-profile";
import { getVocabulary } from "@/lib/search/vocabulary";
import { requireMember } from "@/lib/viewer";
import { WelcomeForm } from "./welcome-form";

export const metadata: Metadata = { title: "Welcome" };

async function Setup() {
  const viewer = await requireMember("/welcome");
  const [profile, { places }] = await Promise.all([loadMyProfile(viewer), getVocabulary()]);
  if (!profile) return <NoProfileNotice />;
  return (
    <WelcomeForm
      defaults={{
        personId: profile.id,
        current_title: profile.current_title ?? "",
        employer: profile.organizations?.name ?? "",
        place_id: profile.place_id ? String(profile.place_id) : "",
        current_city: [profile.city, profile.state].filter(Boolean).join(", "),
        open_to: profile.open_to,
      }}
      places={places.map((p) => ({ value: String(p.id), label: `${p.name}, ${p.state}` }))}
    />
  );
}

export default function WelcomePage() {
  return (
    <>
      <PageTitle
        eyebrow="Welcome to Alumni Connect"
        title="Two quick checks."
        description="Confirm where you are now and what you’re open to, so the right alumni can find you."
      />
      <Suspense fallback={<div className="narrow panel pad"><div className="skeleton big" /><div className="skeleton" /></div>}>
        <Setup />
      </Suspense>
    </>
  );
}
