"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin/review", label: "Profile review" },
  { href: "/admin/claims", label: "Claim requests" },
  { href: "/admin/roster", label: "Roster preview" },
  { href: "/admin/pilot", label: "Pilot progress" },
];

export function AdminTabs() {
  const pathname = usePathname();
  return (
    <nav className="tabs" aria-label="Administration">
      {TABS.map((tab) => (
        <Link key={tab.href} href={tab.href} aria-current={pathname.startsWith(tab.href) ? "page" : undefined}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
