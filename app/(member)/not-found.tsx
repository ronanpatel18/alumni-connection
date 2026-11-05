import type { Metadata } from "next";
import { NotFoundMessage } from "@/components/status-message";

export const metadata: Metadata = { title: "Page not found" };

export default function MemberNotFound() {
  return <NotFoundMessage />;
}
