/**
 * How long a page waits for an optional AI line. Provider timeouts and retries
 * can add up to minutes when a host is overloaded, and a streamed page stays
 * open until its last line resolves, so this caps the wait for the page's sake.
 */
export const OPTIONAL_AI_MS = 15_000;

/** Rejects if `work` hasn't settled in time. The work itself isn't cancelled. */
export async function withDeadline<T>(work: Promise<T>, ms = OPTIONAL_AI_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`No answer within ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([work, expired]);
  } finally {
    clearTimeout(timer);
  }
}
