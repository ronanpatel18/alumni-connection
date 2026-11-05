import Link from "next/link";
import { Icon } from "./icon";

export function NoProfileNotice() {
  return (
    <section className="narrow panel pad">
      <div className="notice">
        <Icon name="info" />
        <div>
          <p>
            <strong>You haven’t claimed a profile yet.</strong>
          </p>
          <p>
            If you received an invitation email, open its private link to claim your profile. Once it’s linked to your
            account you can edit it and manage your contact details here.
          </p>
        </div>
      </div>
      <div className="form-actions">
        <Link className="btn" href="/discover">
          Back to Discover
        </Link>
      </div>
    </section>
  );
}
