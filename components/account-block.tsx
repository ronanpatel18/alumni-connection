import { AdminNavItem } from "@/components/app-frame";
import { createClient } from "@/lib/supabase/server";
import { initialsFor } from "@/lib/labels";
import { getViewer } from "@/lib/viewer";

const ROLE_LABELS: Record<string, string> = {
  member: "Verified member",
  chapter_leader: "Chapter leader",
  admin: "Administrator",
  super_admin: "Administrator",
  pending: "Verification pending",
};

// Kept here for existing imports; it lives in lib/labels so client components can use it.
export { initialsFor } from "@/lib/labels";

export async function AccountBlock() {
  const viewer = await getViewer();
  if (!viewer) return null;
  const label = viewer.email ?? "Signed in";
  return (
    <div className="account">
      <span className="avatar small red" aria-hidden="true">
        {initialsFor(label)}
      </span>
      <div className="od-field" style={{ minWidth: 0 }}>
        <strong className="small od-truncate">{label}</strong>
        <span className="meta">{ROLE_LABELS[viewer.role] ?? viewer.role}</span>
        <form action="/auth/signout" method="post">
          <button type="submit" className="btn quiet" style={{ paddingInline: 0, minHeight: 32 }}>
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}

export async function SavedCount() {
  const viewer = await getViewer();
  if (!viewer?.isVerified) return null;
  const supabase = await createClient();
  const { count } = await supabase.from("saved_contacts").select("person_id", { count: "exact", head: true }).eq("owner_user_id", viewer.userId);
  return <>{count ?? 0}</>;
}

/** The sidebar's Administration link, for administrators only. */
export async function AdminNav() {
  const viewer = await getViewer();
  return viewer?.isAdmin ? <AdminNavItem /> : null;
}
