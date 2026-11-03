import { Inngest } from "inngest";

// Locally, `npx inngest-cli dev` discovers functions at /api/inngest. In
// production the Inngest Cloud keys (INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY) are read from env.
export const inngest = new Inngest({ id: "alumni-connect" });

export const EVENTS = {
  summaryRequested: "people/summary.requested",
  summaryBackfill: "people/summaries.backfill",
} as const;
