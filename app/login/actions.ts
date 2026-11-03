"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { publicEnv } from "@/lib/env";
import { checkRateLimit, getClientIP, LIMITS } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { emailSchema } from "@/lib/validation";

export type LoginState = { status: "idle" } | { status: "sent"; email: string } | { status: "error"; message: string };

const loginSchema = z.object({
  email: emailSchema,
  next: z.string().startsWith("/").max(500).catch("/discover"),
});

/** Emails a one-time sign-in link. Same flow for new and returning users. */
export async function sendMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({ email: formData.get("email"), next: formData.get("next") ?? "/discover" });
  if (!parsed.success) return { status: "error", message: "Enter a valid email address." };

  const limit = await checkRateLimit("login", getClientIP(await headers()), LIMITS.strict);
  if (!limit.allowed) return { status: "error", message: "Too many attempts. Try again in a minute." };

  const supabase = await createClient();
  const redirectTo = new URL("/auth/confirm", publicEnv.NEXT_PUBLIC_SITE_URL);
  redirectTo.searchParams.set("next", parsed.data.next);

  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { emailRedirectTo: redirectTo.toString() },
  });
  if (error) return { status: "error", message: "We couldn't send the link. Try again shortly." };
  return { status: "sent", email: parsed.data.email };
}
