"use client";

import { useEffect } from "react";

/** Applies filters as soon as a select or checkbox changes (the design has no separate "Apply"). */
export function AutoSubmit({ formId }: { formId: string }) {
  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;
    const onChange = (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.matches("select, input[type=checkbox]")) form.requestSubmit();
    };
    form.addEventListener("change", onChange);
    return () => form.removeEventListener("change", onChange);
  }, [formId]);
  return null;
}
