import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { DEV_LOGIN_PATH, devAutoLoginEmail } from "@/lib/dev-auto-login";

// Pages that require a signed-in user. Verification (member vs. pending) is
// checked in the pages themselves, since it needs a database lookup.
const PROTECTED_PREFIXES = ["/discover", "/search", "/people", "/saved", "/messages", "/introductions", "/trips", "/insights", "/me", "/admin", "/pending"];

/** Refreshes the Supabase session cookie on every request and gates protected pages. */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
          for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
        },
      },
    },
  );

  // Must run before anything else so a refreshed token is written to the response.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  const { pathname } = request.nextUrl;
  if (!signedIn && PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    // Keep the host the browser used (localhost vs 127.0.0.1); cookies are per host.
    const host = request.headers.get("host") ?? request.nextUrl.host;
    // Local development with DEV_AUTO_LOGIN_EMAIL: sign in automatically instead.
    const signInPath = devAutoLoginEmail() ? DEV_LOGIN_PATH : "/login";
    const url = new URL(`${signInPath}?next=${encodeURIComponent(pathname + request.nextUrl.search)}`, `${request.nextUrl.protocol}//${host}`);
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|api/inngest|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
