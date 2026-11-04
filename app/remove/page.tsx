import type { Metadata } from "next";
import { Icon } from "@/components/icon";
import { PublicHeader } from "@/components/public-header";

export const metadata: Metadata = { title: "Remove your profile" };

export default function RemoveHelpPage() {
  return (
    <>
      <PublicHeader action={{ href: "/login", label: "Sign in" }} />
      <main className="public-main">
        <div className="eyebrow accent" style={{ marginBottom: 16 }}>
          No account required
        </div>
        <h1>Remove your profile.</h1>
        <p>You control whether you’re part of this network.</p>
        <section className="panel pad">
          <div className="notice">
            <Icon name="mail" />
            <div>
              <p>
                Use the private link in your invitation email to remove your profile in one step. There’s no public search,
                so the network never reveals who’s in it.
              </p>
              <p>No link? Contact the Alumni Connect team and we’ll remove it for you.</p>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
