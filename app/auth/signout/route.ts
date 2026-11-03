import { NextResponse } from "next/server";
import { publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/", publicEnv.NEXT_PUBLIC_SITE_URL), { status: 303 });
}
