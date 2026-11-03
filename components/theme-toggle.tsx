"use client";

import { Icon } from "./icon";

export const THEME_STORAGE_KEY = "alumni-connect-theme";

/** Runs before paint (inlined in <head>) so a stored theme doesn't flash. */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

/** System preference first; an explicit choice is stored when storage is available. */
export function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    const dark = root.dataset.theme === "dark" || (!root.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
    const next = dark ? "light" : "dark";
    root.dataset.theme = next;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private browsing: the choice lasts for this page only.
    }
  }

  return (
    <button type="button" className="icon-button" onClick={toggle} aria-label="Switch light and dark theme">
      <Icon name="sun" />
    </button>
  );
}
