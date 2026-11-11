"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/events", label: "Events" },
  { href: "/jobs", label: "Jobs" },
  { href: "/mentorship", label: "Mentorship" },
  { href: "/businesses", label: "Businesses" },
  { href: "/insights", label: "Insights" },
];

export function CommunityTabs() {
  const pathname = usePathname();
  return (
    <nav className="tabs" aria-label="Community">
      {TABS.map((tab) => (
        <Link key={tab.href} href={tab.href} aria-current={pathname === tab.href || pathname.startsWith(`${tab.href}/`) ? "page" : undefined}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
