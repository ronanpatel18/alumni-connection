"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { OPEN_TO_VALUES } from "@/lib/ai/schemas";
import { loadMyProfile } from "@/lib/my-profile";
import { createClient } from "@/lib/supabase/server";
import { MAX_LENGTHS, sanitizeString } from "@/lib/validation";
import { requireMember } from "@/lib/viewer";

export type WelcomeState = { status: "idle" } | { status: "error"; message: string };

const text = (max: number) => z.string().max(max).transform(sanitizeString);
const schema = z.object({
  current_title: text(MAX_LENGTHS.headline),
  employer: text(200),
  place_id: z.union([z.literal("").transform(() => null), z.coerce.number().int().positive()]),
  open_to: z.array(z.enum(OPEN_TO_VALUES)).max(OPEN_TO_VALUES.length),
});

/** Saves the short setup after a claim. Everything it doesn't ask about stays as it is. */
export async function confirmProfile(_prev: WelcomeState, formData: FormData): Promise<WelcomeState> {
  const viewer = await requireMember("/welcome");
  const profile = await loadMyProfile(viewer);
  if (!profile) return { status: "error", message: "We couldn’t find your profile. Try claiming it again from your invitation." };

  const parsed = schema.safeParse({
    current_title: formData.get("current_title") ?? "",
    employer: formData.get("employer") ?? "",
    place_id: formData.get("place_id") ?? "",
    open_to: formData.getAll("open_to"),
  });
  if (!parsed.success) return { status: "error", message: "Check your role and city, then try again." };

  // update_my_profile replaces what it's given. Blank education fields skip that
  // step, so class years and verified degrees aren't rewritten by this form.
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_my_profile", {
    p: { ...parsed.data, full_name: profile.full_name, industry_id: profile.industry_id, bio: profile.bio, class_year: null, school: null, degree: null, major: null },
  });
  if (error) return { status: "error", message: "We couldn’t save that. Your answers are still here; try again." };

  revalidatePath("/", "layout");
  redirect(`/people/${profile.id}?claimed=1`);
}
