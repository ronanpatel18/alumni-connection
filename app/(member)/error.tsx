"use client"; // Error boundaries must be Client Components

import { ErrorMessage } from "@/components/status-message";

export default function MemberError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorMessage error={error} retry={retry} />;
}
