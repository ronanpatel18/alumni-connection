import { deliverNotificationsJob } from "./deliver-notifications";
import { backfillEmbeddings } from "./embed-people";
import { backfillSummaries, summarizePerson } from "./summarize-person";

export const functions = [summarizePerson, backfillSummaries, backfillEmbeddings, deliverNotificationsJob];
