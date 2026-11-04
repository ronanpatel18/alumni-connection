import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

// Private per-person links for "Is this you? Claim or remove". The token goes
// in the invitation email; only its SHA-256 is stored. There is deliberately no
// public name search, so the directory never reveals who is in it.

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,100}$/;

export function newLinkToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashLinkToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

interface LinkPerson {
  name: string;
  class_year: number | null;
  groups: string[];
}

export type LinkIdentity =
  | { state: "invalid" }
  | { state: "expired" }
  | { state: "removed" }
  | ({ state: "valid" } & LinkPerson)
  | ({ state: "claimed" } & LinkPerson);

export async function linkIdentity(token: string): Promise<LinkIdentity> {
  if (!TOKEN_PATTERN.test(token)) return { state: "invalid" };
  const { data, error } = await createAdminClient().rpc("profile_link_identity", { p_token_sha256: hashLinkToken(token) });
  if (error) throw error;
  return data as LinkIdentity;
}

export type ClaimResult =
  | { status: "approved"; person_id: string; name: string }
  | { status: "pending"; person_id: string; name: string }
  | { status: "error"; reason: "invalid_link" | "removed" | "expired" | "already_claimed" | "no_account" | "has_other_profile" };

export async function claimByLink(token: string, userId: string, email: string): Promise<ClaimResult> {
  if (!TOKEN_PATTERN.test(token)) return { status: "error", reason: "invalid_link" };
  const { data, error } = await createAdminClient().rpc("claim_profile", {
    p_token_sha256: hashLinkToken(token),
    p_user_id: userId,
    p_user_email: email,
  });
  if (error) throw error;
  return data as ClaimResult;
}

export async function removeByLink(token: string): Promise<{ status: "removed" } | { status: "error"; reason: string }> {
  if (!TOKEN_PATTERN.test(token)) return { status: "error", reason: "invalid_link" };
  const { data, error } = await createAdminClient().rpc("remove_profile_by_link", { p_token_sha256: hashLinkToken(token) });
  if (error) throw error;
  return data as { status: "removed" } | { status: "error"; reason: string };
}

export const CLAIM_ERROR_MESSAGES: Record<string, string> = {
  invalid_link: "This link isn’t valid. Check that you copied the whole link from your invitation email.",
  expired: "This link has expired. Ask for a new invitation link.",
  removed: "This profile has been removed from the network.",
  already_claimed: "This profile has already been claimed by another account. If that wasn’t you, contact the Alumni Connect team.",
  no_account: "We couldn’t find your account. Sign in again and retry.",
  has_other_profile: "Your account is already linked to a different profile. Contact the Alumni Connect team if that’s a mistake.",
};
