import Link from "next/link";
import { Brand } from "./brand";

export function PublicHeader({ action = { href: "/login", label: "Already a member? Sign in" } }: { action?: { href: string; label: string } }) {
  return (
    <header className="public-header">
      <Brand href="/" />
      <Link className="btn quiet" href={action.href}>
        {action.label}
      </Link>
    </header>
  );
}
