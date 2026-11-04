import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type IntroStatus = "pending_connector" | "pending_target" | "accepted" | "declined" | "cancelled" | "expired";
export type IntroRole = "requester" | "connector" | "recipient";

export interface IntroDetails {
  id: string;
  status: IntroStatus;
  goal: string;
  message: string | null;
  created_at: string;
  expires_at: string;
  my_role: IntroRole;
  requester_name: string;
  requester_headline: string | null;
  connector_id: string;
  connector_name: string;
  target_id: string;
  target_name: string;
  target_headline: string | null;
}

export async function introDetails(db: SupabaseClient, id: string): Promise<IntroDetails | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await db.rpc("intro_request_details", { p_intro: id });
  return ((data ?? []) as IntroDetails[])[0] ?? null;
}

const first = (name: string) => name.split(" ")[0];

/** Where a request stands, worded for the person looking at it. A decline never says who declined. */
export function introStatusText(d: Pick<IntroDetails, "status" | "my_role" | "connector_name" | "target_name">): string {
  switch (d.status) {
    case "pending_connector":
      return d.my_role === "connector" ? "Waiting for your decision" : `Waiting for ${first(d.connector_name)} to decide`;
    case "pending_target":
      if (d.my_role === "recipient") return "Waiting for your decision";
      if (d.my_role === "connector") return `You agreed · waiting for ${first(d.target_name)}`;
      return `${first(d.connector_name)} agreed · waiting for ${first(d.target_name)}`;
    case "accepted":
      return "Both agreed · introduction made";
    case "declined":
      return "Didn’t go ahead · no details were shared";
    case "cancelled":
      return "Cancelled · no details were shared";
    case "expired":
      return "Expired after 30 days · no details were shared";
  }
}

export const isOpen = (status: IntroStatus) => status === "pending_connector" || status === "pending_target";
