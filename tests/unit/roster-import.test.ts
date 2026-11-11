import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { RosterRow } from "@/lib/importers/roster";
import { importRosterRows } from "@/lib/importers/roster-import";

/** Just enough of the Supabase client: canned reads, recorded inserts. */
function fakeDb(tables: Record<string, Record<string, unknown>[]>) {
  const inserted: Record<string, Record<string, unknown>[]> = {};
  const from = (table: string) => {
    const read = { data: tables[table] ?? [], error: null };
    const chain: Record<string, unknown> = {
      select: () => chain,
      order: () => chain,
      eq: () => chain,
      range: () => chain,
      returns: () => Promise.resolve(read),
      single: () => Promise.resolve({ data: (tables[table] ?? [])[0], error: null }),
      insert: (rows: Record<string, unknown> | Record<string, unknown>[]) => {
        (inserted[table] ??= []).push(...(Array.isArray(rows) ? rows : [rows]));
        return Promise.resolve({ error: null });
      },
      then: (resolve: (value: typeof read) => unknown) => resolve(read),
    };
    return chain;
  };
  return { db: { from } as unknown as SupabaseClient, inserted };
}

const row = (n: number, over: Partial<RosterRow>): RosterRow => ({ row: n, name: "", email: "", classYear: "", title: "", employer: "", city: "", state: "", linkedin: "", source: "WSB", ...over });

describe("importRosterRows", () => {
  it("adds only rows that are still new, with what the roster says about each", async () => {
    const { db, inserted } = fakeDb({
      institutions: [{ id: "inst" }],
      people: [{ id: "p-existing", full_name: "Erin Existing", contact_points: [] }],
      suppression_list: [{ full_name: "Rita Removed", email_sha256: null }],
      organizations: [{ id: "org-epic", name: "Epic" }],
      places: [{ id: 7, name: "Madison", state: "WI" }],
    });
    const result = await importRosterRows(
      db,
      [
        row(1, { name: "Jane Doe", email: "Jane@Example.com", classYear: "2004", title: "Team Lead", employer: "epic", city: "Madison", state: "wi", linkedin: "https://www.linkedin.com/in/jane-doe?trk=x" }),
        row(2, { name: "Erin Existing" }),
        row(3, { name: "Rita Removed" }),
        row(4, { name: "Sam Sparse", classYear: "1850", email: "not-an-email", city: "Wausau", state: "WI" }),
        row(5, { name: "Nia New", employer: "Fresh Co", title: "Founder" }),
      ],
      "admin-user",
      "WSB Alumni Relations",
    );

    expect(result.imported.map((p) => [p.name, p.missing])).toEqual([
      ["Jane Doe", []],
      ["Sam Sparse", ["class year", "role"]],
      ["Nia New", ["class year", "location"]],
    ]);
    expect(result.skipped).toBe(2);

    const [jane, sam, nia] = inserted.people;
    expect(jane).toMatchObject({ full_name: "Jane Doe", first_name: "Jane", last_name: "Doe", current_title: "Team Lead", current_organization_id: "org-epic", place_id: 7, alumni_status: "confirmed", status: "seeded" });
    expect(sam).toMatchObject({ city: "Wausau", state: "WI", place_id: null, current_title: null });
    expect(nia).toMatchObject({ seniority: "owner", headline: "Founder at Fresh Co" });
    // A new employer is created once; a known one is reused whatever its capitals.
    expect(inserted.organizations).toEqual([{ id: nia.current_organization_id, name: "Fresh Co" }]);
    expect(inserted.educations).toEqual([{ person_id: jane.id, institution_id: "inst", grad_year: 2004, verified_by: "roster" }]);
    // Roster emails stay private; an invalid one isn't stored at all.
    expect(inserted.contact_points).toEqual([
      { person_id: jane.id, kind: "email", value: "jane@example.com", source: "roster", visibility: "private" },
      { person_id: jane.id, kind: "linkedin", value: "https://www.linkedin.com/in/jane-doe", label: "work", source: "roster", visibility: "members" },
    ]);
    expect(inserted.field_provenance.every((p) => p.source === "roster")).toBe(true);
    expect(inserted.audit_log).toMatchObject([{ actor_user_id: "admin-user", action: "admin_import_roster", metadata: { imported: 3 } }]);
  });
});
