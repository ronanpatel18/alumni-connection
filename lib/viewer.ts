import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type MemberRole = "pending" | "member" | "chapter_leader" | "admin" | "super_admin";

export interface Viewer {
  userId: string;
  email: string | null;
  role: MemberRole;
  personId: string | null;
  isVerified: boolean;
  isAdmin: boolean;
}

/** The signed-in user and their membership, or null. Cached for the request. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return null;

  const { data: member } = await supabase
    .from("members")
    .select("role, person_id, email")
    .eq("user_id", userId)
    .maybeSingle<{ role: MemberRole; person_id: string | null; email: string | null }>();

  const role = member?.role ?? "pending";
  return {
    userId,
    email: (data.claims.email as string | undefined) ?? member?.email ?? null,
    role,
    personId: member?.person_id ?? null,
    isVerified: role !== "pending",
    isAdmin: role === "admin" || role === "super_admin",
  };
});

/** For member-only pages: sends signed-out users to /login and unverified users to /pending. */
export async function requireMember(next = "/discover"): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (!viewer.isVerified) redirect("/pending");
  return viewer;
}

/** For administration pages: members who aren't administrators go to Discover. */
export async function requireAdmin(next = "/admin"): Promise<Viewer> {
  const viewer = await requireMember(next);
  if (!viewer.isAdmin) redirect("/discover");
  return viewer;
}
