"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { OPEN_TO_VALUES } from "@/lib/ai/schemas";
import { loadMyProfile } from "@/lib/my-profile";
import { hashLinkToken, newLinkToken, removeByLink } from "@/lib/profile-links";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { MAX_LENGTHS, sanitizeString } from "@/lib/validation";
import { requireMember } from "@/lib/viewer";

export type FormState = { status: "idle" } | { status: "saved"; message: string } | { status: "error"; message: string; fields?: Record<string, string> };

const text = (max: number) => z.string().max(max).transform(sanitizeString);
const optionalInt = (min: number, max: number) =>
  z.string().transform((raw, ctx) => {
    const value = raw.trim();
    if (!value) return null;
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) {
      ctx.addIssue({ code: "custom", message: "Invalid number" });
      return z.NEVER;
    }
    return n;
  });

const profileSchema = z.object({
  full_name: text(MAX_LENGTHS.name).pipe(z.string().min(1, "Enter your full name.")),
  current_title: text(MAX_LENGTHS.headline),
  employer: text(200),
  place_id: optionalInt(1, 1_000_000),
  industry_id: optionalInt(1, 10_000),
  class_year: optionalInt(1930, new Date().getFullYear() + 6),
  school: text(200),
  degree_major: text(200),
  open_to: z.array(z.enum(OPEN_TO_VALUES)).max(OPEN_TO_VALUES.length),
  bio: text(MAX_LENGTHS.bio),
});

function fieldErrors(error: z.ZodError) {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    fields[key] ??=
      key === "class_year" ? "Enter a four-digit year, such as 2009." : key === "full_name" ? "Enter your full name." : issue.message;
  }
  return fields;
}

export async function saveProfile(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireMember("/me");
  const parsed = profileSchema.safeParse({
    full_name: formData.get("full_name") ?? "",
    current_title: formData.get("current_title") ?? "",
    employer: formData.get("employer") ?? "",
    place_id: formData.get("place_id") ?? "",
    industry_id: formData.get("industry_id") ?? "",
    class_year: formData.get("class_year") ?? "",
    school: formData.get("school") ?? "",
    degree_major: formData.get("degree_major") ?? "",
    open_to: formData.getAll("open_to"),
    bio: formData.get("bio") ?? "",
  });
  if (!parsed.success) return { status: "error", message: "Check the highlighted fields.", fields: fieldErrors(parsed.error) };

  // "BBA, Finance" → degree "BBA", major "Finance".
  const [degree, ...majorParts] = parsed.data.degree_major.split(",");
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_my_profile", {
    p: { ...parsed.data, degree: degree?.trim() ?? "", major: majorParts.join(",").trim() },
  });
  if (error) return { status: "error", message: "We couldn’t save your profile. Your changes are still here; try again." };

  revalidatePath("/", "layout");
  return { status: "saved", message: "Profile saved. Your edits now replace what came from public sources." };
}

const CONTACT_KINDS = ["email", "phone", "website", "linkedin"] as const;
const contactValue = {
  email: z.union([z.literal(""), z.email("Enter a complete email address, such as alex@example.com.")]),
  phone: z.union([z.literal(""), z.string().regex(/^[+0-9 ().-]{7,30}$/, "Enter a phone number using digits, spaces, dashes or parentheses.")]),
  website: z.union([z.literal(""), z.url({ protocol: /^https?$/, message: "Enter a full web address starting with https://." })]),
  linkedin: z.union([
    z.literal(""),
    z.url({ protocol: /^https$/, hostname: /(^|\.)linkedin\.com$/, message: "Enter your LinkedIn profile address, starting with https://www.linkedin.com/in/." }),
  ]),
};

export async function saveContacts(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireMember("/me/privacy");
  const fields: Record<string, string> = {};
  // Every detail is visible to verified members; a blank field removes it.
  const items: { kind: string; value: string; visibility: "members" }[] = [];
  for (const kind of CONTACT_KINDS) {
    const value = sanitizeString(String(formData.get(`${kind}_value`) ?? ""));
    const parsedValue = contactValue[kind].safeParse(value);
    if (!parsedValue.success) fields[`${kind}_value`] = parsedValue.error.issues[0].message;
    items.push({ kind, value, visibility: "members" });
  }
  if (Object.keys(fields).length) return { status: "error", message: "Check the highlighted details.", fields };

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_my_contacts", { p: items });
  if (error) return { status: "error", message: "We couldn’t save your details. Your changes are still here; try again." };

  revalidatePath("/", "layout");
  return { status: "saved", message: "Contact details saved. A changed email address needs verifying again." };
}

/** "Leave the network": same removal as the public private-link flow, then sign out. */
export async function removeMyProfile() {
  const viewer = await requireMember("/me/privacy");
  const profile = await loadMyProfile(viewer);
  if (!profile) redirect("/me");

  const token = newLinkToken();
  const { error } = await createAdminClient().from("profile_links").insert({ person_id: profile.id, token_sha256: hashLinkToken(token) });
  if (error) throw error;
  await removeByLink(token);
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(`/remove/${token}`);
}
