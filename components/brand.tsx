import Link from "next/link";

export function Brand({ href = "/discover" }: { href?: string }) {
  return (
    <Link className="brand" href={href}>
      <span className="brand-symbol" aria-hidden="true">
        a<span style={{ color: "var(--fg)", fontSize: 20 }}>·</span>
      </span>
      <span>
        <span className="brand-name">Alumni Connect</span>
        <span className="brand-sub">Wisconsin · Nationwide</span>
      </span>
    </Link>
  );
}
