/** One person's "why", once a shared AI request for the whole list finishes (stream it in a Suspense). */
export async function Relevance({ reasons, personId, evidence }: { reasons: Promise<Map<string, string>>; personId: string; evidence?: string | null }) {
  const why = (await reasons).get(personId);
  if (!why && !evidence) return null;
  return (
    <>
      {why && (
        <>
          <span className="chip ai">AI-generated relevance</span>
          <p className="small">{why}</p>
        </>
      )}
      {evidence && <p className="meta">{evidence}</p>}
    </>
  );
}
