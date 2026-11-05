import Link from "next/link";

/** The body of the 404 page, shared by the public and signed-in layouts. */
export function NotFoundMessage() {
  return (
    <>
      <div className="eyebrow accent" style={{ marginBottom: 16 }}>
        Page not found
      </div>
      <h1>We couldn’t find that page.</h1>
      <p style={{ marginTop: 12 }}>It may have moved, or you may not have access to it. If you followed a link from someone, ask them to check it.</p>
      <div className="form-actions">
        <Link className="btn primary" href="/">
          Go to Alumni Connect
        </Link>
      </div>
    </>
  );
}

/** The body of the error page, shared by the public and signed-in layouts. */
export function ErrorMessage({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = (error as { digest?: string } | null)?.digest;
  return (
    <>
      <div className="eyebrow accent" style={{ marginBottom: 16 }}>
        Something went wrong
      </div>
      <h1>This page didn’t load.</h1>
      <p style={{ marginTop: 12 }}>Your work is safe. Try again, and if it keeps happening, contact the Alumni Connect team.</p>
      <div className="form-actions">
        <button type="button" className="btn primary" onClick={() => retry()}>
          Try again
        </button>
      </div>
      {digest && <p className="meta">Reference: {digest}</p>}
    </>
  );
}
