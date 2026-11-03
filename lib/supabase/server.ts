import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { publicEnv } from "@/lib/env";

/** Supabase client for Server Components, Server Actions and Route Handlers. Runs as the signed-in user, so RLS applies. */
export async function createClient() {
  // Session checks read the clock (token expiry), so everything that touches
  // Supabase renders at request time rather than in a prefetch/prerender.
  await connection();
  const cookieStore = await cookies();
  return createServerClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component, which can't set cookies. The proxy refreshes sessions instead.
        }
      },
    },
  });
}
