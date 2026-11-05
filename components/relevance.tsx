/** One person's "why", once a shared AI request for the whole list finishes (stream it in a Suspense). */
export async function Relevance({ reasons, personId }: { reasons: Promise<Map<string, string>>; personId: string }) {
  const why = (await reasons).get(personId);
  if (!why) return null;
  return (
    <>
      <span className="chip ai">AI-generated relevance</span>
      <p className="small">{why}</p>
    </>
  );
}
