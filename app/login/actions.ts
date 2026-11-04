"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { DEV_LOGIN_PATH, devAutoLoginEmail } from "@/lib/dev-auto-login";
import { checkRateLimit, getClientIP, LIMITS } from "@/lib/rate-limit";
import { sendSignInEmail } from "@/lib/sign-in-link";
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

  // Local development: the dev admin (DEV_AUTO_LOGIN_EMAIL) skips the inbox and
  // goes straight to everyone in the directory.
  if (parsed.data.email.toLowerCase() === devAutoLoginEmail()) {
    const next = parsed.data.next === "/discover" ? "/search" : parsed.data.next;
    redirect(`${DEV_LOGIN_PATH}?next=${encodeURIComponent(next)}`);
  }

  const limit = await checkRateLimit("login", getClientIP(await headers()), LIMITS.strict);
  if (!limit.allowed) return { status: "error", message: "Too many attempts. Try again in a minute." };

  const result = await sendSignInEmail(parsed.data.email, parsed.data.next);
  if (result === "limited") return { status: "error", message: "Too many attempts. Try again in a minute." };
  if (result === "failed") return { status: "error", message: "We couldn't send the link. Try again shortly." };
  return { status: "sent", email: parsed.data.email };
}
