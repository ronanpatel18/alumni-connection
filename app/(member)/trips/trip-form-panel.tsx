import { getVocabulary } from "@/lib/search/vocabulary";
import { type TripDefaults, TripForm } from "./trip-form";

/** The planner form with its city and industry choices, plus the privacy rail. */
export async function TripFormPanel({ defaults }: { defaults: TripDefaults }) {
  const { industries, places } = await getVocabulary();
  return (
    <div className="split">
      <TripForm
        defaults={defaults}
        places={places.map((p) => ({ value: String(p.id), label: `${p.name}, ${p.state}` }))}
        sectors={industries.filter((i) => i.parent_id === null).map((i) => ({ value: i.slug, label: i.name }))}
      />
      <aside className="right-rail stack">
        <section className="panel pad">
          <h2 className="rail-title">A shortlist, with reasons</h2>
          <p className="small muted">
            We’ll suggest alumni whose location and work fit your trip, each with a short note on why they’re relevant to your goal.
          </p>
          <div className="divider" />
          <p className="small muted">Your trip is private. Nobody is notified unless you choose to send a message.</p>
        </section>
      </aside>
    </div>
  );
}
