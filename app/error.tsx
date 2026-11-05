"use client"; // Error boundaries must be Client Components

import { PublicHeader } from "@/components/public-header";
import { ErrorMessage } from "@/components/status-message";

export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <>
      <PublicHeader action={{ href: "/", label: "Go to Alumni Connect" }} />
      <main className="public-main">
        <ErrorMessage error={error} retry={retry} />
      </main>
    </>
  );
}
