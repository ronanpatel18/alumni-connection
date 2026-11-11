import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { CommunityTabs } from "@/components/community-tabs";
import { PageTitle } from "@/components/person";
import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/viewer";
import { postJob } from "../actions";

export const metadata: Metadata = { title: "Post a job" };

async function NewJob() {
  const viewer = await requireMember("/jobs");
  const supabase = await createClient();
  const [{ data: industries }, { data: me }] = await Promise.all([
    supabase.from("industries").select("id, name").order("name").returns<{ id: number; name: string }[]>(),
    viewer.personId
      ? supabase.from("people").select("industry_id, organizations:current_organization_id(name)").eq("id", viewer.personId).maybeSingle<{ industry_id: number | null; organizations: { name: string } | null }>()
      : Promise.resolve({ data: null }),
  ]);
  return (
    <div className="narrow">
      <ActionForm
        action={postJob}
        submitLabel="Post job"
        pendingLabel="Posting…"
        secondary={
          <Link className="btn" href="/jobs">
            Cancel
          </Link>
        }
      >
        <h2>Post a job</h2>
        <p className="small muted" style={{ margin: "12px 0 24px" }}>
          Verified members see it with your name. It comes down after 60 days, or when you close it.
        </p>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="title">Job title</label>
            <input id="title" name="title" maxLength={200} required />
          </div>
          <div className="field">
            <label htmlFor="organization_name">Employer</label>
            <input id="organization_name" name="organization_name" maxLength={200} required defaultValue={me?.organizations?.name ?? ""} />
          </div>
          <div className="field">
            <label htmlFor="location">Location</label>
            <input id="location" name="location" maxLength={200} placeholder="Chicago, IL" />
          </div>
          <div className="field">
            <label htmlFor="employment_type">Type</label>
            <select id="employment_type" name="employment_type" defaultValue="full_time">
              <option value="full_time">Full-time</option>
              <option value="part_time">Part-time</option>
              <option value="contract">Contract</option>
              <option value="internship">Internship</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="industry_id">Industry</label>
            <select id="industry_id" name="industry_id" defaultValue={me?.industry_id ?? ""}>
              <option value="">Not sure</option>
              {(industries ?? []).map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="url">Link to the posting (optional)</label>
            <input id="url" name="url" type="url" maxLength={500} placeholder="https://" />
          </div>
          <div className="field full">
            <label htmlFor="description">About the role</label>
            <textarea id="description" name="description" rows={5} maxLength={5000} placeholder="What the job is, who it suits, and anything a fellow alum should know before asking." />
          </div>
        </div>
        <label className="checkbox" style={{ marginTop: 16 }}>
          <input type="checkbox" name="is_remote" />
          Can be done remotely
        </label>
        <label className="checkbox">
          <input type="checkbox" name="can_refer" defaultChecked />
          I’m willing to refer alumni who ask
        </label>
      </ActionForm>
    </div>
  );
}

export default function NewJobPage() {
  return (
    <>
      <PageTitle eyebrow="Community / Jobs and referrals" title="Open a door for a fellow Badger." description="Share an opening at your company or one you know of." />
      <CommunityTabs />
      <Suspense fallback={<div className="panel pad"><div className="skeleton big" /><div className="skeleton" /></div>}>
        <NewJob />
      </Suspense>
    </>
  );
}
