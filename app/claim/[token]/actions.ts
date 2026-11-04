"use server";

import { headers } from "next/headers";
import { linkIdentity } from "@/lib/profile-links";
import { checkRateLimit, getClientIP, LIMITS } from "@/lib/rate-limit";
import { sendSignInEmail } from "@/lib/sign-in-link";
import { emailSchema } from "@/lib/validation";

export type StartClaimState = { status: "idle" } | { status: "sent"; email: string } | { status: "error"; message: string };

/** Signs the person in by email; after the link is opened, /claim/[token]/complete runs the claim. */
export async function startClaim(token: string, _prev: StartClaimState, formData: FormData): Promise<StartClaimState> {
  const email = emailSchema.safeParse(formData.get("email"));
  if (!email.success) return { status: "error", message: "Enter a complete email address, such as alex@example.com." };

  const limit = await checkRateLimit("claim", getClientIP(await headers()), LIMITS.strict);
  if (!limit.allowed) return { status: "error", message: "Too many attempts. Try again in a minute." };

  const identity = await linkIdentity(token);
  if (identity.state !== "valid") return { status: "error", message: "This link can no longer be used to claim a profile." };

  const result = await sendSignInEmail(email.data, `/claim/${token}/complete`);
  if (result === "limited") return { status: "error", message: "Too many attempts. Try again in a minute." };
  if (result === "failed") return { status: "error", message: "We couldn’t send the email. Try again shortly." };
  return { status: "sent", email: email.data };
}
