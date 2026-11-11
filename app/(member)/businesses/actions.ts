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
  name: text(200).pipe(z.string().min(1, "Add the business name.")),
  category: text(80).pipe(z.string().min(1, "Choose a category.")),
  description: text(2000),
  website: linkSchema,
  place_id: z.union([z.literal(""), z.coerce.number().int().positive()]),
  city: text(100),
  state: z.string().trim().toUpperCase().refine((v) => v === "" || /^[A-Z]{2}$/.test(v), "Use a two-letter state, such as WI."),
  alumni_offer: text(300),
});

/** Lists a business the member owns or runs. It shows with their name. */
export async function listBusiness(_prev: FormState, formData: FormData): Promise<FormState> {
  const viewer = await requireMember("/businesses");
  const parsed = schema.safeParse({
    name: formData.get("name") ?? "",
    category: formData.get("category") ?? "",
    description: formData.get("description") ?? "",
    website: formData.get("website") ?? "",
    place_id: formData.get("place_id") ?? "",
    city: formData.get("city") ?? "",
    state: formData.get("state") ?? "",
    alumni_offer: formData.get("alumni_offer") ?? "",
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  const b = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from("business_listings").insert({
    owner_user_id: viewer.userId,
    name: b.name,
    category: b.category,
    description: b.description || null,
    website: b.website || null,
    place_id: b.place_id || null,
    city: b.place_id ? null : b.city || null,
    state: b.place_id ? null : b.state || null,
    alumni_offer: b.alumni_offer || null,
  });
  if (error) return { status: "error", message: "The listing couldn’t be saved. Try again." };
  revalidatePath("/businesses");
  redirect("/businesses?result=listed");
}

export async function removeBusiness(formData: FormData) {
  await requireMember("/businesses");
  const id = uuidSchema.safeParse(formData.get("id"));
  if (!id.success) redirect("/businesses");
  const supabase = await createClient();
  const { data } = await supabase.from("business_listings").delete().eq("id", id.data).select("id");
  revalidatePath("/businesses");
  redirect(`/businesses?result=${data?.length ? "removed" : "error"}`);
}
