import { deliverNotificationsJob } from "./deliver-notifications";
import { backfillEmbeddings } from "./embed-people";
import { keepProfilesCurrent } from "./keep-profiles-current";
import { backfillSummaries, summarizePerson } from "./summarize-person";

export const functions = [summarizePerson, backfillSummaries, backfillEmbeddings, keepProfilesCurrent, deliverNotificationsJob];
