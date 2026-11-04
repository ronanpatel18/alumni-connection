"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ALUMNI_STATUS_LABELS } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { MAX_LENGTHS, sanitizeString } from "@/lib/validation";
import { requireAdmin } from "@/lib/viewer";

export type ReviewState = { status: "idle" } | { status: "error"; message: string; fields?: Record<string, string> };

const text = (max: number) => z.string().max(max).transform(sanitizeString);
const maxYear = new Date().getFullYear() + 6;

const educationSchema = z.object({
  id: z.union([z.literal(""), z.string().uuid()]),
  degree: text(100),
  major: text(200),
  school: text(200),
  grad_year: z
    .string()
    .trim()
    .refine((v) => v === "" || (/^\d{4}$/.test(v) && Number(v) >= 1900 && Number(v) <= maxYear), `Enter a year between 1900 and ${maxYear}.`),
});

const reviewSchema = z.object({
  person_id: z.string().uuid(),
  full_name: text(MAX_LENGTHS.name).pipe(z.string().min(1, "Enter the person’s full name.")),
  current_title: text(MAX_LENGTHS.headline),
  employer: text(200),
  city: text(100),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === "" || /^[A-Z]{2}$/.test(v), "Use a two-letter state code, such as WI."),
  industry_id: z.string().regex(/^\d*$/),
  alumni_status: z.enum(Object.keys(ALUMNI_STATUS_LABELS) as [string, ...string[]]),
  note: text(2000).pipe(z.string().min(1, "Say what you checked, and where.")),
  educations: z.array(educationSchema).max(6),
});

export async function reviewProfile(_prev: ReviewState, formData: FormData): Promise<ReviewState> {
  await requireAdmin();
  const column = (name: string) => formData.getAll(name).map(String);
  const ids = column("edu_id");
  const parsed = reviewSchema.safeParse({
    person_id: formData.get("person_id") ?? "",
    full_name: formData.get("full_name") ?? "",
    current_title: formData.get("current_title") ?? "",
    employer: formData.get("employer") ?? "",
    city: formData.get("city") ?? "",
    state: formData.get("state") ?? "",
    industry_id: formData.get("industry_id") ?? "",
    alumni_status: formData.get("alumni_status") ?? "",
    note: formData.get("note") ?? "",
    educations: ids.map((id, i) => ({
      id,
      degree: column("edu_degree")[i] ?? "",
      major: column("edu_major")[i] ?? "",
      school: column("edu_school")[i] ?? "",
      grad_year: column("edu_year")[i] ?? "",
    })),
  });
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] === "educations" ? `edu_year_${String(issue.path[1])}` : String(issue.path[0]);
      fields[key] ??= issue.message;
    }
    return { status: "error", message: "Check the highlighted fields.", fields };
  }

  const { person_id, note, educations, ...profile } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_review_profile", {
    p_person_id: person_id,
    p: { ...profile, educations: educations.map((e) => ({ ...e, id: e.id || null })) },
    p_note: note,
  });
  if (error) {
    return { status: "error", message: error.code === "42501" || error.code === "22023" ? error.message : "The review couldn’t be saved. Try again." };
  }

  revalidatePath("/admin/review");
  revalidatePath(`/people/${person_id}`);
  redirect("/admin/review?saved=1");
}

const decisionSchema = z.object({ request_id: z.string().uuid(), decision: z.enum(["approve", "decline"]) });

export async function decideClaim(formData: FormData) {
  await requireAdmin("/admin/claims");
  const parsed = decisionSchema.safeParse({ request_id: formData.get("request_id"), decision: formData.get("decision") });
  if (!parsed.success) redirect("/admin/claims?result=error");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_decide_claim", {
    p_request_id: parsed.data.request_id,
    p_approve: parsed.data.decision === "approve",
  });
  const result = error ? "error" : ((data as { status: string; reason?: string }).reason ?? (data as { status: string }).status);
  revalidatePath("/admin/claims");
  redirect(`/admin/claims?result=${result}`);
}
