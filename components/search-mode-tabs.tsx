import Link from "next/link";

/** The two ways to search people: filters and keywords, or a described goal. */
export function SearchModeTabs({ current }: { current: "filters" | "ask" }) {
  return (
    <nav className="tabs" aria-label="Search mode">
      <Link href="/search" aria-current={current === "filters" ? "page" : undefined}>
        Search and filter
      </Link>
      <Link href="/search/ask" aria-current={current === "ask" ? "page" : undefined}>
        Describe who you want to meet
      </Link>
    </nav>
  );
}
