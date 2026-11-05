import type { Metadata } from "next";
import { PublicHeader } from "@/components/public-header";
import { NotFoundMessage } from "@/components/status-message";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <>
      <PublicHeader action={{ href: "/", label: "Go to Alumni Connect" }} />
      <main className="public-main">
        <NotFoundMessage />
      </main>
    </>
  );
}
