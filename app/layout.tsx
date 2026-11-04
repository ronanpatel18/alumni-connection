import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Alumni Connect", template: "%s · Alumni Connect" },
  description: "The professional network for University of Wisconsin–Madison alumni.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { colorScheme: "light" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  // Light mode only: data-theme="light" switches off the design tokens' dark
  // values (they apply only to :root:not([data-theme=light])).
  return (
    <html lang="en" data-theme="light">
      <body>{children}</body>
    </html>
  );
}
