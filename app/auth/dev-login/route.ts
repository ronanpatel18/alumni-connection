import { type NextRequest, NextResponse } from "next/server";
import { devAutoLoginEmail } from "@/lib/dev-auto-login";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Local development only (see lib/dev-auto-login.ts): signs the browser in as
 * DEV_AUTO_LOGIN_EMAIL, creating that account as a verified admin if needed.
 */
export async function GET(request: NextRequest) {
  const email = devAutoLoginEmail();
  if (!email) return new NextResponse("Not found", { status: 404 });

  // Stay on the host the browser used (localhost vs 127.0.0.1): cookies are per host.
  const host = request.headers.get("host") ?? request.nextUrl.host;
  const origin = `${request.nextUrl.protocol}//${host}`;
  const nextParam = request.nextUrl.searchParams.get("next") ?? "/discover";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/discover";
  const fail = (step: string, error: unknown) => {
    console.error(`[dev-login] ${step} failed for ${email}:`, error);
    return NextResponse.redirect(new URL("/login?error=dev-login", origin));
  };

  const admin = createAdminClient();
  // Create the account on first use (a link for an unknown email would be a
  // sign-up token, not a sign-in one), then mint a one-time sign-in token.
  const created = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (created.error && created.error.code !== "email_exists") return fail("create user", created.error);
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) return fail("sign-in token", link.error);

  const { error: roleError } = await admin
    .from("members")
    .update({ role: "admin", verified_at: new Date().toISOString(), verification_method: "dev" })
    .eq("user_id", link.data.user.id)
    .not("role", "in", "(admin,super_admin)");
  if (roleError) return fail("admin role", roleError);

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: link.data.properties.hashed_token });
  if (error) return fail("sign in", error);

  return NextResponse.redirect(new URL(next, origin));
}
