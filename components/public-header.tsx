import Link from "next/link";
import { Brand } from "./brand";

export function PublicHeader({
  action = { href: "/login", lead: "Already a member?", label: "Sign in" },
}: {
  action?: { href: string; lead?: string; label: string };
}) {
  return (
    <header className="public-header">
      <Brand href="/" />
      <Link className="btn quiet" href={action.href}>
        <span>
          {action.lead && <span className="header-lead">{action.lead} </span>}
          {action.label}
        </span>
      </Link>
    </header>
  );
}
