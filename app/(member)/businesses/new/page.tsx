import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { CommunityTabs } from "@/components/community-tabs";
import { PageTitle } from "@/components/person";
import { BUSINESS_CATEGORIES } from "@/lib/business-categories";
import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/viewer";
import { listBusiness } from "../actions";

export const metadata: Metadata = { title: "List your business" };

async function NewBusiness() {
  await requireMember("/businesses");
  const supabase = await createClient();
  const { data: places } = await supabase.from("places").select("id, name, state").order("name").returns<{ id: number; name: string; state: string }[]>();
  return (
    <div className="narrow">
      <ActionForm
        action={listBusiness}
        submitLabel="List business"
        pendingLabel="Saving…"
        secondary={
          <Link className="btn" href="/businesses">
            Cancel
          </Link>
        }
      >
        <h2>List your business</h2>
        <p className="small muted" style={{ margin: "12px 0 24px" }}>
          For a business you own or run. Verified members see it with your name, and you can remove it anytime.
        </p>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="name">Business name</label>
            <input id="name" name="name" maxLength={200} required />
          </div>
          <div className="field">
            <label htmlFor="category">Category</label>
            <select id="category" name="category" defaultValue="" required>
              <option value="" disabled>
                Choose one
              </option>
              {BUSINESS_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="place_id">City</label>
            <select id="place_id" name="place_id" defaultValue="">
              <option value="">Not listed, or online only</option>
              {(places ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}, {p.state}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="city">Another city (if not listed)</label>
            <div className="od-cluster">
              <input id="city" name="city" maxLength={100} placeholder="City" style={{ flex: 2, minWidth: 120 }} />
              <input name="state" maxLength={2} placeholder="WI" aria-label="State" style={{ flex: 1, minWidth: 60 }} />
            </div>
          </div>
          <div className="field full">
            <label htmlFor="website">Website (optional)</label>
            <input id="website" name="website" type="url" maxLength={500} placeholder="https://" />
          </div>
          <div className="field full">
            <label htmlFor="description">What you do</label>
            <textarea id="description" name="description" rows={4} maxLength={2000} />
          </div>
          <div className="field full">
            <label htmlFor="alumni_offer">Something for fellow alumni (optional)</label>
            <input id="alumni_offer" name="alumni_offer" maxLength={300} placeholder="10% off for Badgers, or a free first consultation" />
          </div>
        </div>
      </ActionForm>
    </div>
  );
}

export default function NewBusinessPage() {
  return (
    <>
      <PageTitle eyebrow="Community / Alumni businesses" title="Put your business in front of Badgers." description="A short listing members can search by what you do and where." />
      <CommunityTabs />
      <Suspense fallback={<div className="panel pad"><div className="skeleton big" /><div className="skeleton" /></div>}>
        <NewBusiness />
      </Suspense>
    </>
  );
}
