"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/me", label: "Edit profile" },
  { href: "/me/privacy", label: "Privacy & visibility" },
  { href: "/me/sources", label: "Data sources" },
];

export function ProfileTabs() {
  const pathname = usePathname();
  return (
    <nav className="tabs" aria-label="Profile & privacy">
      {TABS.map((tab) => (
        <Link key={tab.href} href={tab.href} aria-current={pathname === tab.href ? "page" : undefined}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
