"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { deliverNotifications } from "@/lib/notifications";
import { createClient } from "@/lib/supabase/server";
import { sanitizeString } from "@/lib/validation";
import { requireMember } from "@/lib/viewer";

export type MessageState =
  | { status: "idle" }
  | { status: "sent"; count: number }
  | { status: "error"; message: string; body?: string; attempt: number };

const text = (max: number) => z.string().max(max).transform(sanitizeString);
const startSchema = z.object({
  person_id: z.string().uuid(),
  trip_id: z.union([z.literal(""), z.string().uuid()]),
  subject: text(200),
  body: text(5000).pipe(z.string().min(1, "Write a message.")),
});

/** Sends a first message through Alumni Connect. The recipient gets an email; neither address is shared. */
export async function startConversation(prev: MessageState, formData: FormData): Promise<MessageState> {
  await requireMember("/messages");
  const attempt = prev.status === "error" ? prev.attempt + 1 : 1;
  const parsed = startSchema.safeParse({
    person_id: formData.get("person_id"),
    trip_id: formData.get("trip_id") ?? "",
    subject: formData.get("subject") ?? "",
    body: formData.get("body") ?? "",
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the message.", body: String(formData.get("body") ?? ""), attempt };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("start_conversation", {
    p_person: parsed.data.person_id,
    p_subject: parsed.data.subject,
    p_body: parsed.data.body,
    p_trip: parsed.data.trip_id || null,
  });
  if (error) {
    const known = ["P0002", "22023", "54000", "42501"].includes(error.code ?? "");
    return { status: "error", message: known ? error.message : "The message couldn’t be sent. Try again.", body: parsed.data.body, attempt };
  }
  await deliverNotifications();
  revalidatePath("/messages");
  redirect(`/messages/${data as string}?sent=1`);
}

const replySchema = z.object({ conversation_id: z.string().uuid(), body: text(5000).pipe(z.string().min(1, "Write a message.")) });

export async function sendReply(prev: MessageState, formData: FormData): Promise<MessageState> {
  await requireMember("/messages");
  const attempt = prev.status === "error" ? prev.attempt + 1 : 1;
  const parsed = replySchema.safeParse({ conversation_id: formData.get("conversation_id"), body: formData.get("body") ?? "" });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the message.", attempt };
  const supabase = await createClient();
  const { error } = await supabase.rpc("send_message", { p_conversation: parsed.data.conversation_id, p_body: parsed.data.body });
  if (error) return { status: "error", message: "The message couldn’t be sent. Try again.", body: parsed.data.body, attempt };
  await deliverNotifications();
  revalidatePath(`/messages/${parsed.data.conversation_id}`);
  return { status: "sent", count: (prev.status === "sent" ? prev.count : 0) + 1 };
}
