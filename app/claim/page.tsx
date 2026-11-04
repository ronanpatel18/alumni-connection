import type { Metadata } from "next";
import { Icon } from "@/components/icon";
import { PublicHeader } from "@/components/public-header";

export const metadata: Metadata = { title: "Claim your profile" };

/** No public search on purpose: a name lookup would reveal who is in the directory. */
export default function ClaimHelpPage() {
  return (
    <>
      <PublicHeader />
      <main className="public-main">
        <div className="eyebrow accent" style={{ marginBottom: 16 }}>
          Your profile. Your choice.
        </div>
        <h1>Is there a profile for you?</h1>
        <p>
          If we have a profile for you, your invitation email contains a private link to claim it or remove it. That link
          is the only way to find your record: there’s no public search, so the network never reveals who’s in it.
        </p>
        <section className="panel pad">
          <div className="notice">
            <Icon name="mail" />
            <div>
              <p>
                <strong>Lost your link?</strong> Contact the Alumni Connect team and we’ll send a new one to an email
                address we have on file for you.
              </p>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
