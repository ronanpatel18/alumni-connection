"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Brand } from "./brand";
import { Icon, type IconName } from "./icon";
import { ThemeToggle } from "./theme-toggle";

// Only areas that exist today. Trips, Insights and Administration join this list
// as they're built (their prototypes are in design/prototypes/screens).
const NAV: { href: string; label: string; icon: IconName; matches: string[] }[] = [
  { href: "/discover", label: "Discover", icon: "search", matches: ["/discover", "/search", "/people"] },
  { href: "/saved", label: "Relationships", icon: "people", matches: ["/saved"] },
];

/**
 * Member workspace chrome from the design: persistent sidebar on desktop,
 * sticky top bar with a labeled menu control on phones (Escape closes it).
 */
export function AppFrame({ account, savedCount, children }: { account: ReactNode; savedCount: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const active = NAV.find((item) => item.matches.some((m) => pathname === m || pathname.startsWith(`${m}/`)));

  // Close the mobile menu after navigating.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setMenuOpen(false);
  }

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <div className={`app${menuOpen ? " menu-open" : ""}`} id="app-shell">
        <aside className="sidebar">
          <Brand />
          <nav aria-label="Main navigation">
            {NAV.map((item) => (
              <Link key={item.href} className="nav-item" href={item.href} aria-current={item === active ? "page" : undefined}>
                <Icon name={item.icon} />
                <span>{item.label}</span>
                {item.href === "/saved" && <span className="nav-count">{savedCount}</span>}
              </Link>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="chapter-note">
              <span className="eyebrow">A shared beginning.</span>
              <p>A nationwide network of Wisconsin alumni, built on real relationships.</p>
              <Link className="small" href="/search">
                Find your next connection <Icon name="arrow" />
              </Link>
            </div>
            {account}
          </div>
        </aside>
        <div className="workspace">
          <header className="topbar">
            <span className="crumb">
              Your network <span style={{ padding: "0 8px" }}>/</span> <b>{active?.label ?? "Discover"}</b>
            </span>
            <Link className="mobile-brand" href="/discover">
              Alumni Connect<span className="accent">.</span>
            </Link>
            <div className="top-actions">
              <span className="trust">
                <Icon name="lock" />
                <span>Private. Verified alumni only.</span>
              </span>
              <ThemeToggle />
              <button
                ref={menuButton}
                type="button"
                className="icon-button menu-button"
                onClick={() => setMenuOpen((open) => !open)}
                aria-label={menuOpen ? "Close navigation" : "Open navigation"}
                aria-expanded={menuOpen}
              >
                <Icon name={menuOpen ? "close" : "menu"} />
              </button>
            </div>
          </header>
          <main className="content" id="main" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
    </>
  );
}
