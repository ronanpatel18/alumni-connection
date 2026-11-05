import { NextResponse } from "next/server";
import { publicEnv } from "@/lib/env";
import { claimByLink } from "@/lib/profile-links";
import { checkRateLimit, getClientIP, LIMITS } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

/** Runs after the claimant signs in: links the profile, or files it for review. */
export async function GET(request: Request, { params }: RouteContext<"/claim/[token]/complete">) {
  const { token } = await params;
  const site = publicEnv.NEXT_PUBLIC_SITE_URL;
  const back = (query = "") => NextResponse.redirect(new URL(`/claim/${token}${query}`, site));

  const limit = await checkRateLimit("claim", getClientIP(request.headers), LIMITS.strict);
  if (!limit.allowed) return back();

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  const email = data?.claims?.email as string | undefined;
  if (!userId || !email) {
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(`/claim/${token}/complete`)}`, site));
  }

  const result = await claimByLink(token, userId, email);
  if (result.status === "approved") return NextResponse.redirect(new URL("/welcome", site));
  if (result.status === "pending") return back("?status=submitted");
  return back(`?error=${result.reason}`);
}
