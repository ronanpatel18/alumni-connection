"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Icon } from "./icon";

const LAST_SEARCH_KEY = "alumni-connect:last-search";

/** Placed on the search page: remembers its URL (filters, page) for the back link. */
export function RememberSearch() {
  useEffect(() => {
    try {
      sessionStorage.setItem(LAST_SEARCH_KEY, location.pathname + location.search);
    } catch {
      // Storage unavailable (private mode): the back link falls back to a fresh search.
    }
  });
  return null;
}

/** Returns to the member's last search with its filters, or to a fresh search. */
export function BackToSearch() {
  const router = useRouter();
  return (
    <Link
      className="btn quiet back-link"
      href="/search"
      onClick={(event) => {
        let last: string | null = null;
        try {
          last = sessionStorage.getItem(LAST_SEARCH_KEY);
        } catch {}
        if (last?.startsWith("/search")) {
          event.preventDefault();
          router.push(last);
        }
      }}
    >
      <Icon name="back" /> Back to search
    </Link>
  );
}
