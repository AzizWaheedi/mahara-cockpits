import type { SupabaseClient } from "@supabase/supabase-js";
import { calendarWrite } from "./nativeCalendarClient";
import {
  nativeCommsOverview,
  nativeWaArchive,
  nativeWaInbox,
  nativeWaReply,
} from "./nativeCommsClient";

const APP = "media-buyer";
export function fetchMeetingsOverview(client: SupabaseClient) {
  return nativeCommsOverview(client, APP);
}
export function sendReply(
  client: SupabaseClient,
  args: { chatId: string; text: string; contextKey: string },
  options: { requestId?: string } = {},
) {
  return nativeWaReply(client, APP, args, { ...options, apply: true });
}
export async function linkCalendar(client: SupabaseClient, calendarId: string) {
  await calendarWrite(
    client,
    APP,
    "personalCalendars.link",
    { calendarId },
    { apply: true },
  );
}
export async function unlinkCalendar(client: SupabaseClient) {
  await calendarWrite(
    client,
    APP,
    "personalCalendars.unlink",
    {},
    { apply: true },
  );
}
export function fetchWaInbox(
  client: SupabaseClient,
  desk: "csm" | "ads" | "creative",
) {
  if (desk !== "ads") throw new Error("Do not use another WhatsApp desk.");
  return nativeWaInbox(client, APP);
}
export async function archiveWaThread(
  client: SupabaseClient,
  chatId: string,
  contextKey: string,
  requestId: string,
) {
  await nativeWaArchive(client, APP, chatId, contextKey, requestId, true);
}
