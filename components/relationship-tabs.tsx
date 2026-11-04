"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/saved", label: "Saved contacts" },
  { href: "/messages", label: "Messages" },
  { href: "/introductions", label: "Introductions" },
];

export function RelationshipTabs() {
  const pathname = usePathname();
  return (
    <nav className="tabs" aria-label="Relationships">
      {TABS.map((tab) => (
        <Link key={tab.href} href={tab.href} aria-current={pathname === tab.href || pathname.startsWith(`${tab.href}/`) ? "page" : undefined}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
