import { Suspense } from "react";
import { PersonRow } from "@/components/person";
import { Relevance } from "@/components/relevance";
import type { Suggestion } from "@/lib/recommendations";

/**
 * A suggested person with what the viewer can do next. Everything here is known
 * immediately; only the AI line waits, so it streams in below the facts.
 */
export function SuggestionRow({
  suggestion: { person, evidence, action, whyUs },
  saved,
  cue,
  linkedin,
  reasons,
}: {
  suggestion: Suggestion;
  saved: boolean;
  cue?: string | null;
  linkedin?: string | null;
  reasons: Promise<Map<string, string>>;
}) {
  return (
    <>
      <PersonRow person={person} saved={saved} cue={cue} linkedin={linkedin} action={action.kind === "save" ? null : action} />
      <div className="pad suggestion-why">
        {whyUs && (
          <p className="small">
            <strong>Why us?</strong> {whyUs}
          </p>
        )}
        {evidence.length > 0 && <p className="meta">{evidence.join(" · ")}</p>}
        <Suspense
          fallback={
            <p className="meta" role="status">
              Writing why they may be relevant…
            </p>
          }
        >
          <Relevance reasons={reasons} personId={person.id} />
        </Suspense>
        {action.kind === "save" && (
          <p className="meta">
            Hasn’t joined yet, so messages and introductions aren’t available.{" "}
            {saved ? "This profile is in your saved contacts." : "Save this profile to come back to it."}
          </p>
        )}
      </div>
    </>
  );
}
