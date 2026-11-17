import "server-only";
import { after } from "next/server";
import { getAi } from "@/lib/ai";
import { summarizePerson } from "@/lib/summaries";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Rewrites a profile's three-bullet summary after the response is sent, for
 * when its facts have just been edited. Call from a server action.
 */
export function refreshSummaryLater(personId: string) {
  after(() => summarizePerson(createAdminClient(), getAi(), personId).catch(() => undefined));
}
