"use server";

import { headers } from "next/headers";
import { removeByLink } from "@/lib/profile-links";
import { checkRateLimit, getClientIP, LIMITS } from "@/lib/rate-limit";

export type RemoveState = { status: "idle" } | { status: "removed" } | { status: "error"; message: string };

// useActionState passes the previous state first; removal doesn't need it.
export async function removeProfile(token: string): Promise<RemoveState> {
  const limit = await checkRateLimit("remove", getClientIP(await headers()), LIMITS.strict);
  if (!limit.allowed) return { status: "error", message: "Too many attempts. Try again in a minute." };

  const result = await removeByLink(token);
  if (result.status === "removed") return { status: "removed" };
  return {
    status: "error",
    message:
      result.reason === "expired"
        ? "This link has expired. Contact the Alumni Connect team and we’ll remove your profile."
        : "This link isn’t valid. Check that you copied the whole link from your invitation email.",
  };
}
