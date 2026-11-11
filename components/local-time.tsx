"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * A moment shown in the reader's own time zone ("Tue, Nov 17, 3:00 PM CST").
 * The server can't know the zone, so it renders UTC and the browser corrects it.
 */
export function LocalTime({ iso, dateOnly }: { iso: string; dateOnly?: boolean }) {
  const format = (timeZone?: string) =>
    new Date(iso).toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      ...(dateOnly ? {} : { hour: "numeric", minute: "2-digit", timeZoneName: "short" }),
      timeZone,
    });
  const text = useSyncExternalStore(
    subscribe,
    () => format(),
    () => format("UTC"),
  );
  return <time dateTime={iso}>{text}</time>;
}
