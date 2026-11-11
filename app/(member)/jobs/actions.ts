"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { FormState } from "@/components/action-form";
import { createClient } from "@/lib/supabase/server";
import { linkSchema, sanitizeString, uuidSchema } from "@/lib/validation";
import { requireMember } from "@/lib/viewer";

const text = (max: number) => z.string().max(max).transform(sanitizeString);
const schema = z.object({
  title: text(200).pipe(z.string().min(1, "Add the job title.")),
  organization_name: text(200).pipe(z.string().min(1, "Add the employer.")),
  location: text(200),
  is_remote: z.boolean(),
  employment_type: z.enum(["full_time", "part_time", "contract", "internship"]),
  industry_id: z.union([z.literal(""), z.coerce.number().int().positive()]),
  description: text(5000),
  url: linkSchema,
  can_refer: z.boolean(),
});

/** Posts an opening for members. It comes down by itself after 60 days. */
export async function postJob(_prev: FormState, formData: FormData): Promise<FormState> {
  const viewer = await requireMember("/jobs");
  const parsed = schema.safeParse({
    title: formData.get("title") ?? "",
    organization_name: formData.get("organization_name") ?? "",
    location: formData.get("location") ?? "",
    is_remote: formData.get("is_remote") === "on",
    employment_type: formData.get("employment_type") ?? "full_time",
    industry_id: formData.get("industry_id") ?? "",
    description: formData.get("description") ?? "",
    url: formData.get("url") ?? "",
    can_refer: formData.get("can_refer") === "on",
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  const j = parsed.data;
  if (!j.description && !j.url) return { status: "error", message: "Add a short description or a link to the posting." };
  const supabase = await createClient();
  const { error } = await supabase.from("job_posts").insert({
    posted_by: viewer.userId,
    title: j.title,
    organization_name: j.organization_name,
    location: j.location || null,
    is_remote: j.is_remote,
    employment_type: j.employment_type,
    industry_id: j.industry_id || null,
    description: j.description || null,
    url: j.url || null,
    can_refer: j.can_refer,
  });
  if (error) return { status: "error", message: "The job couldn’t be posted. Try again." };
  revalidatePath("/jobs");
  redirect("/jobs?result=posted");
}

/** The poster (or an administrator) marks a job as filled or no longer open. */
export async function closeJob(formData: FormData) {
  await requireMember("/jobs");
  const id = uuidSchema.safeParse(formData.get("id"));
  if (!id.success) redirect("/jobs");
  const supabase = await createClient();
  const { data } = await supabase.from("job_posts").update({ closed_at: new Date().toISOString() }).eq("id", id.data).select("id");
  revalidatePath("/jobs");
  redirect(`/jobs?result=${data?.length ? "closed" : "error"}`);
}
