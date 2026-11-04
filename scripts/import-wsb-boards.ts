// Loads the Wisconsin School of Business advisory-board snapshot into the
// directory: groups, organizations, people, current positions, board
// memberships and per-field provenance. Safe to re-run (matches people by their
// board profile ID). Claimed profiles keep the member's own edits.
//
// Usage: npm run import:wsb-boards -- [path/to/snapshot.json] [--remote]
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isSuppressed, normalizeSnapshot, type NormalizedMember, PARENT_UNIT, SOURCE, snapshotSchema } from "@/lib/importers/wsb-boards";

const DEFAULT_SNAPSHOT = "data/sources/wsb-advisory-boards-2026-11-03.json";
const INSTITUTION_SLUG = "uw-madison";

/** Unwraps a Supabase result, throwing on errors. `maybe` allows "no row" (null). */
function must<T>(result: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  if (result.data == null) throw new Error(`${what}: no data returned`);
  return result.data;
}

function maybe<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
}

async function findOrCreateOrganization(db: SupabaseClient, name: string): Promise<string> {
  const existing = must(
    await db.from("organizations").select("id").ilike("name", name.replace(/[%_\\]/g, "\\$&")).limit(1),
    "find organization",
  );
  if (existing.length) return existing[0].id;
  const created = must(await db.from("organizations").insert({ name }).select("id").single(), `create organization ${name}`);
  return created.id;
}

async function upsertPerson(db: SupabaseClient, institutionId: string, member: NormalizedMember, orgId: string | null, retrievedAt: string) {
  const link = maybe(
    await db.from("person_external_ids").select("person_id").eq("source", SOURCE).eq("external_id", member.externalId).maybeSingle(),
    "find external id",
  );

  const listingFields = {
    full_name: member.fullName,
    first_name: member.firstName,
    last_name: member.lastName,
    headline: member.headline,
    current_title: member.title,
    current_organization_id: orgId,
    seniority: member.seniority,
    bio: member.bio,
    photo_url: member.photoUrl,
  };

  let personId: string;
  let created = false;
  let protectedRole = false;
  if (link) {
    personId = link.person_id;
    const person = must(await db.from("people").select("status").eq("id", personId).single(), "load person");
    // Once someone claims their profile, their own edits win over the listing,
    // and fields an administrator corrected in review are left alone.
    if (person.status === "seeded") {
      const newer = (maybe(
        await db.from("field_provenance").select("field, source").eq("person_id", personId).in("source", ["admin", "web"]),
        "load reviewed fields",
      ) ?? []) as { field: string; source: string }[];
      const reviewed = new Set(newer.filter((r) => r.source === "admin").map((r) => r.field));
      // A role an administrator corrected, or one LinkedIn shows is newer than the listing, stays.
      protectedRole = newer.some((r) => r.field === "current_title" || r.field === "current_organization_id");
      const update: Record<string, unknown> = { ...listingFields };
      if (reviewed.has("full_name")) for (const k of ["full_name", "first_name", "last_name"]) delete update[k];
      if (protectedRole) for (const k of ["current_title", "current_organization_id", "headline", "seniority"]) delete update[k];
      maybe(await db.from("people").update(update).eq("id", personId), "update person");
    }
  } else {
    const inserted = must(
      await db
        .from("people")
        .insert({ institution_id: institutionId, status: "seeded", alumni_status: member.alumniStatus, ...listingFields })
        .select("id")
        .single(),
      `create ${member.fullName}`,
    );
    personId = inserted.id;
    created = true;
    maybe(
      await db.from("person_external_ids").insert({ person_id: personId, source: SOURCE, external_id: member.externalId, url: member.externalUrl }),
      "link external id",
    );
  }

  if (member.title && member.organizationName && !protectedRole) {
    const current = must(
      await db.from("positions").select("id").eq("person_id", personId).eq("is_current", true).eq("title", member.title).eq("organization_name", member.organizationName),
      "find position",
    );
    if (!current.length) {
      maybe(await db.from("positions").update({ is_current: false }).eq("person_id", personId).eq("is_current", true), "close old positions");
      maybe(
        await db.from("positions").insert({
          person_id: personId,
          organization_id: orgId,
          organization_name: member.organizationName,
          title: member.title,
          seniority: member.seniority,
          is_current: true,
        }),
        "add position",
      );
    }
  }

  const fetchedAt = new Date(retrievedAt).toISOString();
  const provenance = (["full_name", "current_title", "current_organization_id", "bio", "photo_url"] as const)
    .filter((field) => (field === "bio" ? member.bio : field === "photo_url" ? member.photoUrl : true))
    .map((field) => ({ person_id: personId, field, source: "institution", confidence: 0.95, source_url: member.externalUrl, fetched_at: fetchedAt }));
  maybe(await db.from("field_provenance").upsert(provenance, { onConflict: "person_id,field,source" }), "record provenance");

  return { personId, created };
}

async function main() {
  const args = process.argv.slice(2);
  const path = args.find((a) => !a.startsWith("--")) ?? DEFAULT_SNAPSHOT;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url) && !args.includes("--remote")) {
    console.error(`${url || "(unset)"} is not a local Supabase. Pass --remote to import there on purpose.`);
    process.exit(1);
  }

  const snapshot = snapshotSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  const members = normalizeSnapshot(snapshot);
  const db = createClient(url, process.env.SUPABASE_SECRET_KEY ?? "", { auth: { persistSession: false } });

  const institution = must(await db.from("institutions").select("id").eq("slug", INSTITUTION_SLUG).single(), "load institution");
  const suppressed = must(
    await db.from("suppression_list").select("full_name, source, external_id").eq("institution_id", institution.id),
    "load suppression list",
  );

  const groupIds = new Map<string, string>();
  for (const group of new Map(members.flatMap((m) => m.groups).map((g) => [g.slug, g])).values()) {
    const row = must(
      await db
        .from("groups")
        .upsert(
          { institution_id: institution.id, slug: group.slug, name: group.name, kind: "advisory_board", parent_unit: PARENT_UNIT, source_url: snapshot.source },
          { onConflict: "slug" },
        )
        .select("id")
        .single(),
      `upsert group ${group.slug}`,
    );
    groupIds.set(group.slug, row.id);
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const member of members) {
    if (isSuppressed(member, suppressed)) {
      skipped++;
      continue;
    }
    const orgId = member.organizationName ? await findOrCreateOrganization(db, member.organizationName) : null;
    const result = await upsertPerson(db, institution.id, member, orgId, snapshot.retrievedAt);
    if (result.created) created++;
    else updated++;

    maybe(
      await db.from("group_memberships").upsert(
        member.groups.map((g) => ({ group_id: groupIds.get(g.slug)!, person_id: result.personId, role: "Member", source_url: member.externalUrl })),
        { onConflict: "group_id,person_id" },
      ),
      "add memberships",
    );
  }

  console.log(`Groups: ${groupIds.size}. People: ${created} created, ${updated} updated, ${skipped} skipped (removal requests).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
