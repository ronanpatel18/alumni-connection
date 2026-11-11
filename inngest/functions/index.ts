import { deliverNotificationsJob, queueFollowUpReminders } from "./deliver-notifications";
import { backfillEmbeddings } from "./embed-people";
import { lookupPersonJob } from "./lookup-person";
import { keepProfilesCurrent } from "./keep-profiles-current";
import { backfillSummaries, summarizePerson } from "./summarize-person";

export const functions = [summarizePerson, backfillSummaries, backfillEmbeddings, keepProfilesCurrent, deliverNotificationsJob, lookupPersonJob, queueFollowUpReminders];
