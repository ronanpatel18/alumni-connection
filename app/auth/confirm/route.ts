import type { EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/** Landing point for magic links: exchanges the code (PKCE) or token hash for a session. */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  // Redirect on the configured site URL, not request.nextUrl.origin: in dev Next.js reports
  // "localhost" even when the browser is on 127.0.0.1, and the session cookie is host-specific.
  const origin = publicEnv.NEXT_PUBLIC_SITE_URL;
  const nextParam = searchParams.get("next") ?? "/discover";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/discover";

  const supabase = await createClient();
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type
      ? await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
      : { error: new Error("Missing code") };

  if (error) {
    return NextResponse.redirect(new URL("/login?error=link", origin));
  }
  return NextResponse.redirect(new URL(next, origin));
}
