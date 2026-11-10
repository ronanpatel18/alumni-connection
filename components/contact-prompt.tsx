import Link from "next/link";
import { missingOwnContacts } from "@/lib/own-contacts";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/viewer";
import { Icon } from "./icon";

/**
 * A nudge for members to add their own email and phone: the most accurate
 * source there is, and the only one shown without review. Renders nothing for
 * members with no claimed profile or with both already added.
 */
export async function ContactPrompt() {
  const viewer = await getViewer();
  if (!viewer?.personId) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("contact_points").select("kind, source").eq("person_id", viewer.personId);
  const missing = missingOwnContacts(data ?? []);
  if (!missing.length) return null;

  const what = missing.length === 2 ? "an email and phone number" : missing[0] === "email" ? "an email address" : "a phone number";
  return (
    <div className="notice" role="note">
      <Icon name="person" />
      <div>
        <p>
          <strong>Make it easy for fellow Badgers to reach you.</strong> Your profile doesn’t have {what} from you yet.
        </p>
        <p className="muted">
          Details you add yourself are the ones members see, and you can change or remove them anytime. It takes under a minute.
        </p>
        <p>
          <Link className="btn" href="/me/privacy" style={{ marginTop: 8 }}>
            Add contact details
          </Link>
        </p>
      </div>
    </div>
  );
}
